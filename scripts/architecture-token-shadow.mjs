/*
 * Architecture Tokens static locator D1 shadow experiment.
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

function locatorKey(nativeId, occurrence) {
  return [
    nativeId,
    occurrence.role,
    occurrence.span.startByte,
    occurrence.span.endByte,
    occurrence.statementSpan.startByte,
    occurrence.statementSpan.endByte,
  ].join(':');
}

/**
 * Verifies the static, revision-scoped node addresses produced by the owned
 * Flowchart parser. It never returns source text; callers may count locators
 * and reason buckets without retaining a diagram body.
 */
export function auditStaticLocators({ source, model, parseFlowchartSource, sliceUtf8ByteSpan }) {
  const reparsed = parseFlowchartSource(source);
  if (reparsed.kind !== 'ok') return { kind: 'unsafe', reasons: ['source_not_canonically_supported'] };

  const syntaxDerived = new Set(
    reparsed.model.nodes.flatMap((node) => node.occurrences.map((occurrence) => locatorKey(node.nativeId, occurrence))),
  );
  const edgeStatements = new Map(
    model.edges.map((edge) => [`${edge.span.startByte}:${edge.span.endByte}`, new Set(edge.endpointNativeIds)]),
  );
  const reasons = new Set();
  const seen = new Set();
  const locators = [];

  for (const node of model.nodes) {
    const primaryKey = locatorKey(node.nativeId, node.primaryOccurrence);
    if (!syntaxDerived.has(primaryKey)) reasons.add('primary_locator_not_syntax_derived');
    if (!node.occurrences.some((occurrence) => locatorKey(node.nativeId, occurrence) === primaryKey)) {
      reasons.add('primary_locator_not_an_occurrence');
    }
    for (const [occurrenceIndex, occurrence] of node.occurrences.entries()) {
      const key = locatorKey(node.nativeId, occurrence);
      if (seen.has(key)) reasons.add('locator_collision');
      seen.add(key);
      if (!syntaxDerived.has(key)) reasons.add('locator_not_syntax_derived');

      let fragment = '';
      try {
        fragment = sliceUtf8ByteSpan(source, occurrence.span);
      } catch {
        reasons.add('invalid_utf8_span');
      }
      if (!fragment.trim()) reasons.add('empty_node_span');

      let statementFragment = '';
      try {
        statementFragment = sliceUtf8ByteSpan(source, occurrence.statementSpan);
      } catch {
        reasons.add('invalid_utf8_statement_span');
      }

      const fragmentParse = fragment
        ? parseFlowchartSource(
          occurrence.role === 'edge_endpoint'
            ? `flowchart TD\n__locator_audit__ --> ${fragment}`
            : `flowchart TD\n${fragment}`,
        )
        : { kind: 'unsupported' };
      if (
        fragmentParse.kind !== 'ok'
        || !fragmentParse.model.nodes.some((candidate) =>
          candidate.nativeId === node.nativeId
          && candidate.occurrences.some((candidateOccurrence) => candidateOccurrence.role === occurrence.role),
        )
      ) {
        reasons.add('node_fragment_not_round_trippable');
      }

      if (occurrence.role === 'declaration' && statementFragment.trim() !== fragment) {
        reasons.add('declaration_fragment_is_not_statement');
      }
      if (occurrence.role === 'edge_endpoint') {
        const endpoints = edgeStatements.get(`${occurrence.statementSpan.startByte}:${occurrence.statementSpan.endByte}`);
        if (!endpoints?.has(node.nativeId)) reasons.add('edge_endpoint_without_edge_context');
      }

      locators.push({
        nativeId: node.nativeId,
        occurrenceIndex,
        isPrimary: key === primaryKey,
        role: occurrence.role,
        span: occurrence.span,
        statementSpan: occurrence.statementSpan,
      });
    }
  }

  return reasons.size === 0
    ? { kind: 'ok', locators }
    : { kind: 'unsafe', reasons: [...reasons].sort() };
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
    flowchartSyntax: {},
    locatorEligibility: {},
    locatorFailureReasons: {},
    locatorRoles: {},
    unsupportedReasons: {},
    nativeIdShapes: {},
    canonicalNodes: 0,
    nodeOccurrences: 0,
    repeatedNodeOccurrences: 0,
    primaryLocators: 0,
    staticFingerprints: 0,
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
    validateMermaid: (source) => parser.parseDsl('mermaid', source),
  };
}

async function analyzeCurrentBody(body, metrics, domain) {
  const stored = parseStoredBody(body);
  increment(metrics.storedBodies, stored.kind);
  if (stored.kind !== 'ok') return;

  const validation = await domain.validateMermaid(stored.code);
  increment(metrics.publicParse, validation.ok ? 'valid' : 'invalid');
  if (!validation.ok) return;

  const parsed = domain.parseFlowchartSource(stored.code);
  if (parsed.kind !== 'ok') {
    increment(metrics.flowchartSyntax, 'unsupported');
    increment(metrics.unsupportedReasons, parsed.reason);
    return;
  }
  increment(metrics.flowchartSyntax, 'supported');

  const locatorAudit = auditStaticLocators({
    source: stored.code,
    model: parsed.model,
    parseFlowchartSource: domain.parseFlowchartSource,
    sliceUtf8ByteSpan: domain.sliceUtf8ByteSpan,
  });
  if (locatorAudit.kind !== 'ok') {
    increment(metrics.locatorEligibility, 'unsafe');
    for (const reason of locatorAudit.reasons) increment(metrics.locatorFailureReasons, reason);
    return;
  }
  increment(metrics.locatorEligibility, 'eligible');
  for (const node of parsed.model.nodes) {
    void domain.fingerprintFlowchartNode(node);
    metrics.primaryLocators += 1;
    metrics.staticFingerprints += 1;
    increment(metrics.nativeIdShapes, idShape(node.nativeId));
    metrics.canonicalNodes += 1;
    for (const occurrence of node.occurrences) {
      metrics.nodeOccurrences += 1;
      increment(metrics.locatorRoles, occurrence.role);
    }
    if (node.occurrences.length > 1) metrics.repeatedNodeOccurrences += 1;
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
  const schema = queryD1("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = 'CustomContent'");
  const counts = queryD1("SELECT COUNT(*) AS mermaid_contents FROM CustomContent WHERE diagramType = 'mermaid'");
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
    state.offset += contents.length;
    await saveJson(stateFile, state);
  }

  const report = {
    experiment: 'architecture_tokens_static_flowchart_locator_audit_v1',
    generatedAt: new Date().toISOString(),
    corpus: counts[0],
    sample: { scope: queryScope, requestedContents: options.limit, processedContents: state.metrics.contents, finalOffset: state.offset },
    safeguards: {
      d1Access: 'read_only_select_only',
      persistence: 'aggregate_checkpoint_and_report_only',
      canonicalStore: 'confluence_custom_content',
      mirrorCaveat: 'D1 is a best-effort mirror; missing rows are not proof that Confluence lacks a revision',
    },
    phaseScope: {
      staticLocator: 'single current Flowchart source only; source-derived UTF-8 node-occurrence spans and role/context round trips',
      parsing: 'public Mermaid parse plus owned canonical Flowchart subset, each reported separately',
      deferred: 'historical versions, reconciliation, retention, global matching, and topology are out of scope for this phase',
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
