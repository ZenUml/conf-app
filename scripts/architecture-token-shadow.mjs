/*
 * Architecture Tokens D1 shadow experiment.
 *
 * This script intentionally has no write path. It processes stored source
 * bodies in memory and emits only aggregate/deidentified metrics. See the
 * adjacent design note for execution and coverage limits.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 500;
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;
const DEFAULT_STATE_DIR = '/private/tmp/conf-app-architecture-token-shadow';
const MUTATION_OR_DDL = /\b(?:INSERT|UPDATE|DELETE|MERGE|REPLACE|CREATE|DROP|ALTER|VACUUM|PRAGMA|ATTACH|DETACH|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK)\b/i;

export function assertReadOnlySql(sql) {
  const trimmed = sql.trim();
  if (!/^(?:SELECT|WITH)\b/i.test(trimmed) || /;/.test(trimmed) || MUTATION_OR_DDL.test(trimmed)) {
    throw new Error('Shadow experiment accepts exactly one read-only SELECT/WITH statement');
  }
  return trimmed;
}

export function parseStoredBody(body) {
  if (typeof body !== 'string') return { kind: 'missing_body' };
  try {
    const envelope = JSON.parse(body);
    if (typeof envelope?.mermaidCode === 'string') return { kind: 'ok', code: envelope.mermaidCode };
    const rawValue = envelope?.raw?.value ?? envelope?.value;
    if (typeof rawValue !== 'string') return { kind: 'missing_raw_value' };
    try {
      const diagram = JSON.parse(rawValue);
      return typeof diagram?.mermaidCode === 'string'
        ? { kind: 'ok', code: diagram.mermaidCode }
        : { kind: 'missing_mermaid_code' };
    } catch {
      return { kind: 'invalid_raw_value_json' };
    }
  } catch {
    return { kind: 'invalid_body_json' };
  }
}

export function idShape(nativeId) {
  if (/^\d+$/.test(nativeId)) return 'numeric_only';
  if (nativeId.length <= 2) return 'very_short';
  if (/^[A-Za-z][A-Za-z0-9_-]{2,}$/.test(nativeId)) return 'identifier_like';
  return 'other';
}

export function deriveUniqueExactNodeSpanRelocations(oldSource, oldNodes, newSource, newNodes, sliceUtf8ByteSpan) {
  const newByFragment = new Map();
  for (const node of newNodes) {
    for (const occurrence of node.occurrences) {
      const fragment = sliceUtf8ByteSpan(newSource, occurrence.span);
      const candidates = newByFragment.get(fragment) ?? new Set();
      candidates.add(node.nativeId);
      newByFragment.set(fragment, candidates);
    }
  }

  const pairs = [];
  for (let index = 0; index < oldNodes.length; index += 1) {
    const oldNode = oldNodes[index];
    const candidates = new Set();
    for (const occurrence of oldNode.occurrences) {
      const fragment = sliceUtf8ByteSpan(oldSource, occurrence.span);
      for (const candidate of newByFragment.get(fragment) ?? []) candidates.add(candidate);
    }
    if (candidates.size === 1) {
      pairs.push({ diagramElementId: `shadow-${index}`, newNativeId: [...candidates][0] });
    }
  }
  return pairs;
}

function increment(counter, key, amount = 1) {
  counter[key] = (counter[key] ?? 0) + amount;
}

function sourceAssessment(source, parseFlowchartSource, validateMermaid, fingerprintFlowchartNode) {
  const parsed = parseFlowchartSource(source);
  if (parsed.kind !== 'ok') return { kind: 'unsupported', reason: parsed.reason };
  const validation = validateMermaid(source);
  return Promise.resolve(validation).then((result) => {
    if (!result.ok) return { kind: 'invalid_mermaid' };
    const fingerprints = parsed.model.nodes.map(fingerprintFlowchartNode);
    return { kind: 'ok', model: parsed.model, fingerprints };
  });
}

export async function analyzePair({ oldSource, newSource, domain }) {
  const oldAssessment = await sourceAssessment(oldSource, domain.parseFlowchartSource, domain.validateMermaid, domain.fingerprintFlowchartNode);
  const newAssessment = await sourceAssessment(newSource, domain.parseFlowchartSource, domain.validateMermaid, domain.fingerprintFlowchartNode);
  if (oldAssessment.kind !== 'ok' || newAssessment.kind !== 'ok') {
    return { kind: 'unsupported', oldKind: oldAssessment.kind, newKind: newAssessment.kind };
  }

  const relocatedPairs = deriveUniqueExactNodeSpanRelocations(
    oldSource,
    oldAssessment.model.nodes,
    newSource,
    newAssessment.model.nodes,
    domain.sliceUtf8ByteSpan,
  );
  const decisions = domain.reconcileFlowchartNodes({
    oldElements: oldAssessment.fingerprints.map((fingerprint, index) => ({
      diagramElementId: `shadow-${index}`,
      fingerprint,
    })),
    newNodes: newAssessment.model.nodes,
    relocatedPairs,
  }).decisions;

  const topologyComparable = oldAssessment.model.nodes.filter((node) => node.incidentNativeIds.length > 0).length;
  return {
    kind: 'ok',
    oldNodeCount: oldAssessment.model.nodes.length,
    newNodeCount: newAssessment.model.nodes.length,
    relocationEvidenceCount: relocatedPairs.length,
    topologyComparable,
    sameNativeIdCandidates: oldAssessment.model.nodes.filter((oldNode) =>
      newAssessment.model.nodes.some((newNode) => newNode.nativeId === oldNode.nativeId),
    ).length,
    decisions,
  };
}

function commandArgs(sql) {
  return ['exec', 'wrangler', 'd1', 'execute', 'conf-zenuml-prod', '--config', 'wrangler-prod.toml', '--env', 'production', '--remote', '--json', '--command', assertReadOnlySql(sql)];
}

function queryD1(sql) {
  const command = spawnSync('pnpm', commandArgs(sql), {
    cwd: resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (command.status !== 0) throw new Error(`Read-only D1 query failed: ${command.stderr || command.stdout}`);
  const start = command.stdout.indexOf('[');
  if (start === -1) throw new Error('Read-only D1 query returned no JSON');
  const parsed = JSON.parse(command.stdout.slice(start));
  const result = parsed[0]?.results;
  if (!Array.isArray(result)) throw new Error('Read-only D1 query returned an unexpected JSON shape');
  return result;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function rowsForVersions(keys) {
  if (keys.length === 0) return [];
  const predicate = keys.map(({ contentId, appId }) => `(contentId = ${sqlString(contentId)} AND appId = ${sqlString(appId)})`).join(' OR ');
  return queryD1(`SELECT contentId, appId, versionNumber, body FROM CustomContentVersion WHERE ${predicate} ORDER BY contentId, appId, versionNumber DESC`);
}

async function loadState(stateFile) {
  try {
    const parsed = JSON.parse(await readFile(stateFile, 'utf8'));
    return parsed?.version === 1 ? parsed : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
}

function newMetrics() {
  return {
    contents: 0,
    storedBodies: {},
    publicParse: {},
    flowchartEligibility: {},
    unsupportedReasons: {},
    nativeIdShapes: {},
    canonicalNodes: 0,
    nodeOccurrences: 0,
    repeatedNodeOccurrences: 0,
    adjacentVersionPairs: 0,
    pairOutcomes: {},
    pairUnsupported: {},
    decisions: {},
    relocationEvidence: 0,
    topologyComparableNodes: 0,
    sameNativeIdCandidates: 0,
  };
}

async function importDomain() {
  const flowchart = await import('../src/domain/architectureTokens/mermaidFlowchart.ts');
  const locator = await import('../src/domain/architectureTokens/utf8Locator.ts');
  const reconciliation = await import('../src/domain/architectureTokens/reconcileFlowchartNodes.ts');
  const parser = await import('../functions/agent-link/parseDsl.ts');
  return {
    parseFlowchartSource: flowchart.parseFlowchartSource,
    sliceUtf8ByteSpan: locator.sliceUtf8ByteSpan,
    fingerprintFlowchartNode: reconciliation.fingerprintFlowchartNode,
    reconcileFlowchartNodes: reconciliation.reconcileFlowchartNodes,
    validateMermaid: (source) => parser.parseDsl('mermaid', source),
  };
}

async function analyzeCurrentBody(body, metrics, domain) {
  const stored = parseStoredBody(body);
  increment(metrics.storedBodies, stored.kind);
  if (stored.kind !== 'ok') return;

  const parsed = domain.parseFlowchartSource(stored.code);
  const validation = await domain.validateMermaid(stored.code);
  increment(metrics.publicParse, validation.ok ? 'valid' : 'invalid');
  if (parsed.kind !== 'ok') {
    increment(metrics.flowchartEligibility, 'unsupported');
    increment(metrics.unsupportedReasons, parsed.reason);
    return;
  }
  if (!validation.ok) {
    increment(metrics.flowchartEligibility, 'invalid_mermaid');
    return;
  }
  increment(metrics.flowchartEligibility, 'eligible');
  for (const node of parsed.model.nodes) {
    increment(metrics.nativeIdShapes, idShape(node.nativeId));
    metrics.canonicalNodes += 1;
    metrics.nodeOccurrences += node.occurrences.length;
    if (node.occurrences.length > 1) metrics.repeatedNodeOccurrences += 1;
  }
}

async function analyzeVersions(versionRows, metrics, domain) {
  const groups = new Map();
  for (const row of versionRows) {
    const key = `${row.contentId}\u0000${row.appId}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const [newer, older] = rows;
    const oldStored = parseStoredBody(older.body);
    const newStored = parseStoredBody(newer.body);
    if (oldStored.kind !== 'ok' || newStored.kind !== 'ok') {
      increment(metrics.pairUnsupported, oldStored.kind !== 'ok' ? `old_${oldStored.kind}` : `new_${newStored.kind}`);
      continue;
    }
    metrics.adjacentVersionPairs += 1;
    const result = await analyzePair({ oldSource: oldStored.code, newSource: newStored.code, domain });
    if (result.kind !== 'ok') {
      increment(metrics.pairOutcomes, 'unsupported');
      increment(metrics.pairUnsupported, `${result.oldKind}_to_${result.newKind}`);
      continue;
    }
    increment(metrics.pairOutcomes, 'eligible');
    metrics.relocationEvidence += result.relocationEvidenceCount;
    metrics.topologyComparableNodes += result.topologyComparable;
    metrics.sameNativeIdCandidates += result.sameNativeIdCandidates;
    for (const decision of result.decisions) increment(metrics.decisions, decision.status);
  }
}

function parseOptions(argv) {
  const options = {
    run: false,
    limit: DEFAULT_LIMIT,
    batchSize: DEFAULT_BATCH_SIZE,
    stateDir: DEFAULT_STATE_DIR,
    flowchartCandidates: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') options.run = true;
    else if (arg === '--dry-run') options.run = false;
    else if (arg === '--limit') options.limit = Number(argv[++index]);
    else if (arg === '--batch-size') options.batchSize = Number(argv[++index]);
    else if (arg === '--state-dir') options.stateDir = argv[++index];
    else if (arg === '--flowchart-candidates') options.flowchartCandidates = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_LIMIT) throw new Error(`--limit must be 1..${MAX_LIMIT}`);
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > MAX_BATCH_SIZE) throw new Error(`--batch-size must be 1..${MAX_BATCH_SIZE}`);
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const schema = queryD1("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('CustomContent', 'CustomContentVersion') ORDER BY name");
  const counts = queryD1("SELECT COUNT(*) AS mermaid_contents, SUM(CASE WHEN latestVersionNumber > 1 THEN 1 ELSE 0 END) AS contents_with_history, SUM(latestVersionNumber) AS mirrored_versions FROM CustomContent WHERE diagramType = 'mermaid'");
  const preflight = { mode: options.run ? 'run' : 'dry_run', schemaTables: schema.map((row) => row.name).sort(), corpus: counts[0] };
  if (!options.run) {
    console.log(JSON.stringify(preflight, null, 2));
    return preflight;
  }

  const stateFile = resolve(options.stateDir, 'checkpoint.json');
  const reportFile = resolve(options.stateDir, 'report.json');
  const resumed = await loadState(stateFile);
  const queryScope = options.flowchartCandidates ? 'flowchart_text_candidate' : 'all_mermaid';
  if (resumed?.queryScope && resumed.queryScope !== queryScope) {
    throw new Error('Checkpoint scope differs from this run; choose a separate --state-dir');
  }
  const state = resumed ?? { version: 1, queryScope, offset: 0, metrics: newMetrics() };
  const domain = await importDomain();

  while (state.offset < options.limit) {
    const remaining = options.limit - state.offset;
    const batchSize = Math.min(options.batchSize, remaining);
    const flowchartPredicate = options.flowchartCandidates
      ? " AND (body LIKE '%flowchart%' OR body LIKE '%graph%')"
      : '';
    const contents = queryD1(`SELECT contentId, appId, body FROM CustomContent WHERE diagramType = 'mermaid'${flowchartPredicate} ORDER BY createdAt DESC, contentId, appId LIMIT ${batchSize} OFFSET ${state.offset}`);
    if (contents.length === 0) break;
    for (const content of contents) {
      state.metrics.contents += 1;
      await analyzeCurrentBody(content.body, state.metrics, domain);
    }
    await analyzeVersions(rowsForVersions(contents), state.metrics, domain);
    state.offset += contents.length;
    await saveJson(stateFile, state);
  }

  const report = {
    experiment: 'architecture_tokens_flowchart_shadow_v1',
    generatedAt: new Date().toISOString(),
    corpus: counts[0],
    sample: { scope: queryScope, requestedContents: options.limit, processedContents: state.metrics.contents, finalOffset: state.offset },
    safeguards: {
      d1Access: 'read_only_select_only',
      persistence: 'aggregate_checkpoint_and_report_only',
      canonicalStore: 'confluence_custom_content',
      mirrorCaveat: 'D1 is a best-effort mirror; missing rows are not proof that Confluence lacks a revision',
    },
    algorithmScope: {
      autoConfirm: 'unique exact UTF-8 node-span relocation plus exact fingerprint',
      nativeId: 'candidate evidence only; never automatic proof',
      topology: 'signal availability only; global weighted assignment is not implemented in this experiment',
      precision: 'unverified without manual review or external identity ground truth',
    },
    metrics: state.metrics,
  };
  await saveJson(reportFile, report);
  console.log(JSON.stringify({ ...preflight, report: reportFile, sample: report.sample, metrics: report.metrics }, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Shadow experiment failed: ${error.message}`);
    process.exitCode = 1;
  });
}
