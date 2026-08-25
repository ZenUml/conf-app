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

async function sourceAssessment(source, domain) {
  // Mermaid's public parser is the syntax authority. The owned parser is a
  // canonicalisation helper and never substitutes for that gate.
  const validation = await domain.validateMermaid(source);
  if (!validation.ok) return { kind: 'invalid_mermaid' };
  const parsed = domain.parseFlowchartSource(source);
  if (parsed.kind !== 'ok') return { kind: 'unsupported', reason: parsed.reason };
  const locatorAudit = auditStaticLocators({
    source,
    model: parsed.model,
    parseFlowchartSource: domain.parseFlowchartSource,
    sliceUtf8ByteSpan: domain.sliceUtf8ByteSpan,
  });
  if (locatorAudit.kind !== 'ok') return { kind: 'unsafe_locators', reasons: locatorAudit.reasons };
  const fingerprints = parsed.model.nodes.map(domain.fingerprintStaticFlowchartNode);
  return { kind: 'ok', model: parsed.model, fingerprints, locatorAudit };
}

function staticLocatorsFor(model) {
  return model.nodes.map((node) => ({
    locatorId: `${node.nativeId}:${node.primaryOccurrence.span.startByte}:${node.primaryOccurrence.span.endByte}`,
    span: node.primaryOccurrence.span,
  }));
}

function revisionDistance(oldVersionNumber, newVersionNumber) {
  if (!Number.isSafeInteger(oldVersionNumber) || !Number.isSafeInteger(newVersionNumber)) return 'unavailable';
  return newVersionNumber - oldVersionNumber === 1 ? 'adjacent' : 'non_adjacent';
}

/**
 * Runs the staged shadow pipeline through its current policy gate. It returns
 * evidence only: the shadow never calls the product reconciler and never
 * emits identity confirmation or binding-transfer decisions.
 */
export async function analyzeHistoricalPair({
  oldSource,
  newSource,
  oldVersionNumber = null,
  newVersionNumber = null,
  domain,
}) {
  const oldAssessment = await sourceAssessment(oldSource, domain);
  const newAssessment = await sourceAssessment(newSource, domain);
  if (oldAssessment.kind !== 'ok' || newAssessment.kind !== 'ok') {
    return {
      kind: 'unsupported',
      oldKind: oldAssessment.kind,
      newKind: newAssessment.kind,
      transfer: null,
    };
  }

  const relocation = domain.prepareSourceDiffRelocation({
    oldSource,
    newSource,
    oldLocators: staticLocatorsFor(oldAssessment.model),
  });
  const nativeIds = domain.assessExactNativeIdNodeCandidates({
    oldNodes: oldAssessment.model.nodes,
    newNodes: newAssessment.model.nodes,
    sourceDiffRelocations: relocation.relocations,
  });
  const scoring = domain.scoreFingerprintCandidates({
    candidateAssessment: nativeIds,
    oldFingerprints: oldAssessment.fingerprints.map((fingerprint, index) => ({
      nativeId: oldAssessment.model.nodes[index].nativeId,
      fingerprint,
    })),
    newFingerprints: newAssessment.fingerprints.map((fingerprint, index) => ({
      nativeId: newAssessment.model.nodes[index].nativeId,
      fingerprint,
    })),
  });
  const assignment = domain.assignMaximumWeightCandidates({ scored: scoring.scored });
  const topology = domain.assessStructuralTopology({
    oldModel: oldAssessment.model,
    newModel: newAssessment.model,
    globalAssignmentSelections: assignment.selected,
  });
  const splitMerge = domain.assessSplitMergePatterns({
    scored: scoring.scored,
    globalAssignmentSelections: assignment.selected,
  });
  const topologyByCandidate = new Map(
    topology.assessed.map((evidence) => [
      `${evidence.selection.candidate.candidate.old.nativeId}:${evidence.selection.candidate.candidate.new.nativeId}`,
      evidence,
    ]),
  );
  const policy = domain.classifyDeleteRecreateConfidence({
    evidence: scoring.scored.map((candidate) => ({
      candidate,
      topology: topologyByCandidate.get(`${candidate.candidate.old.nativeId}:${candidate.candidate.new.nativeId}`) ?? null,
      revisionDistance: revisionDistance(oldVersionNumber, newVersionNumber),
    })),
  });

  return {
    kind: 'ok',
    oldNodeCount: oldAssessment.model.nodes.length,
    newNodeCount: newAssessment.model.nodes.length,
    relocation,
    nativeIds,
    scoring,
    assignment,
    topology,
    splitMerge,
    policy,
    revisionDistance: revisionDistance(oldVersionNumber, newVersionNumber),
    transfer: null,
  };
}

// Compatibility seam for earlier local helper tests. This now delegates to
// the staged evidence pipeline and cannot produce binding decisions.
export async function analyzePair(input) {
  return analyzeHistoricalPair(input);
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
    return parsed?.version === 1 || parsed?.version === 2 ? parsed : null;
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

export function newMetrics() {
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
    staticFingerprintFacts: {},
  };
}

export function newHistoricalMetrics() {
  return {
    pairRows: 0,
    currentStoredBodies: {},
    priorStoredBodies: {},
    currentPublicParse: {},
    priorPublicParse: {},
    currentFlowchartSyntax: {},
    priorFlowchartSyntax: {},
    currentLocatorEligibility: {},
    priorLocatorEligibility: {},
    pairFunnel: {},
    revisionDistance: {},
    sourceDiffHunks: {},
    sourceDiffRelocations: 0,
    sourceDiffUnresolved: {},
    nativeIdCandidates: 0,
    nativeIdUnmatched: {},
    fingerprintScoredCandidates: 0,
    fingerprintScoreBands: {},
    fingerprintUnresolved: {},
    globalAssignmentsSelected: 0,
    globalAssignmentUnresolved: {},
    topologyAssessed: 0,
    topologyUnresolved: {},
    topologyIteration: {},
    splitMergePatterns: {},
    splitMergeUnresolved: {},
    policyOutcomes: {},
    policyReasons: {},
  };
}

function migrateStaticFingerprintMetrics(metrics) {
  if (metrics.staticFingerprintFacts != null) return;
  const legacyCount = metrics.staticFingerprints;
  metrics.staticFingerprintFacts = Number.isSafeInteger(legacyCount)
    ? { syntax: legacyCount, structural: legacyCount }
    : {};
}

async function importDomain() {
  const flowchart = await import('../src/domain/architectureTokens/mermaidFlowchart.ts');
  const locator = await import('../src/domain/architectureTokens/utf8Locator.ts');
  const fingerprint = await import('../src/domain/architectureTokens/flowchartStaticFingerprint.ts');
  const sourceDiff = await import('../src/domain/architectureTokens/sourceDiffRelocation.ts');
  const nativeId = await import('../src/domain/architectureTokens/nativeIdCandidate.ts');
  const scoring = await import('../src/domain/architectureTokens/fingerprintScoring.ts');
  const assignment = await import('../src/domain/architectureTokens/globalAssignment.ts');
  const topology = await import('../src/domain/architectureTokens/structuralTopologyAssessment.ts');
  const splitMerge = await import('../src/domain/architectureTokens/splitMergeAssessment.ts');
  const deleteRecreate = await import('../src/domain/architectureTokens/deleteRecreatePolicy.ts');
  const parser = await import('../functions/agent-link/parseDsl.ts');
  return {
    parseFlowchartSource: flowchart.parseFlowchartSource,
    sliceUtf8ByteSpan: locator.sliceUtf8ByteSpan,
    fingerprintStaticFlowchartNode: fingerprint.fingerprintStaticFlowchartNode,
    prepareSourceDiffRelocation: sourceDiff.prepareSourceDiffRelocation,
    assessExactNativeIdNodeCandidates: nativeId.assessExactNativeIdNodeCandidates,
    scoreFingerprintCandidates: scoring.scoreFingerprintCandidates,
    assignMaximumWeightCandidates: assignment.assignMaximumWeightCandidates,
    assessStructuralTopology: topology.assessStructuralTopology,
    assessSplitMergePatterns: splitMerge.assessSplitMergePatterns,
    classifyDeleteRecreateConfidence: deleteRecreate.classifyDeleteRecreateConfidence,
    validateMermaid: (source) => parser.parseDsl('mermaid', source),
  };
}

export async function analyzeCurrentBody(body, metrics, domain) {
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
    const fingerprint = domain.fingerprintStaticFlowchartNode(node);
    metrics.primaryLocators += 1;
    increment(metrics.staticFingerprintFacts, 'syntax');
    if (fingerprint.structural != null) increment(metrics.staticFingerprintFacts, 'structural');
    increment(metrics.nativeIdShapes, idShape(node.nativeId));
    metrics.canonicalNodes += 1;
    for (const occurrence of node.occurrences) {
      metrics.nodeOccurrences += 1;
      increment(metrics.locatorRoles, occurrence.role);
    }
    if (node.occurrences.length > 1) metrics.repeatedNodeOccurrences += 1;
  }
}

function incrementSourceSide(metrics, side, field, key, amount = 1) {
  increment(metrics[`${side}${field}`], key, amount);
}

async function assessHistoricalSide(body, side, metrics, domain) {
  const stored = parseStoredBody(body);
  incrementSourceSide(metrics, side, 'StoredBodies', stored.kind);
  if (stored.kind !== 'ok') {
    increment(metrics.pairFunnel, `${side}_body_unavailable`);
    return null;
  }
  increment(metrics.pairFunnel, `${side}_body_extractable`);

  const validation = await domain.validateMermaid(stored.code);
  incrementSourceSide(metrics, side, 'PublicParse', validation.ok ? 'valid' : 'invalid');
  if (!validation.ok) {
    increment(metrics.pairFunnel, `${side}_public_parse_invalid`);
    return null;
  }
  increment(metrics.pairFunnel, `${side}_public_parse_valid`);

  const parsed = domain.parseFlowchartSource(stored.code);
  if (parsed.kind !== 'ok') {
    incrementSourceSide(metrics, side, 'FlowchartSyntax', 'unsupported');
    incrementSourceSide(metrics, side, 'FlowchartSyntax', parsed.reason);
    increment(metrics.pairFunnel, `${side}_flowchart_unsupported`);
    return null;
  }
  incrementSourceSide(metrics, side, 'FlowchartSyntax', 'supported');
  increment(metrics.pairFunnel, `${side}_flowchart_supported`);

  const locatorAudit = auditStaticLocators({
    source: stored.code,
    model: parsed.model,
    parseFlowchartSource: domain.parseFlowchartSource,
    sliceUtf8ByteSpan: domain.sliceUtf8ByteSpan,
  });
  if (locatorAudit.kind !== 'ok') {
    incrementSourceSide(metrics, side, 'LocatorEligibility', 'unsafe');
    for (const reason of locatorAudit.reasons) incrementSourceSide(metrics, side, 'LocatorEligibility', reason);
    increment(metrics.pairFunnel, `${side}_locator_unsafe`);
    return null;
  }
  incrementSourceSide(metrics, side, 'LocatorEligibility', 'eligible');
  increment(metrics.pairFunnel, `${side}_locator_eligible`);
  return {
    source: stored.code,
    model: parsed.model,
    fingerprints: parsed.model.nodes.map(domain.fingerprintStaticFlowchartNode),
  };
}

function policyOutcomeBucket(outcome) {
  if (outcome === 'requires_human_confirmation') return 'requires_review';
  if (outcome === 'unresolved_insufficient_evidence' || outcome === 'unresolved_low_confidence') return 'unresolved';
  return outcome;
}

/**
 * Processes one current/prior pair while retaining source only in memory.
 * The returned value is intentionally not written by the harness; callers
 * aggregate it immediately into deidentified metrics.
 */
export async function analyzeHistoricalPairRow(row, metrics, domain) {
  metrics.pairRows += 1;
  increment(metrics.revisionDistance, revisionDistance(row.priorVersionNumber, row.currentVersionNumber));
  const oldAssessment = await assessHistoricalSide(row.priorBody, 'prior', metrics, domain);
  const newAssessment = await assessHistoricalSide(row.currentBody, 'current', metrics, domain);
  if (!oldAssessment || !newAssessment) {
    increment(metrics.pairFunnel, 'not_static_eligible');
    return { kind: 'unsupported' };
  }
  increment(metrics.pairFunnel, 'static_eligible_pair');

  const relocation = domain.prepareSourceDiffRelocation({
    oldSource: oldAssessment.source,
    newSource: newAssessment.source,
    oldLocators: staticLocatorsFor(oldAssessment.model),
  });
  for (const hunk of relocation.hunks) increment(metrics.sourceDiffHunks, hunk.kind);
  metrics.sourceDiffRelocations += relocation.relocations.length;
  for (const unresolved of relocation.unresolved) increment(metrics.sourceDiffUnresolved, unresolved.reason);
  increment(metrics.pairFunnel, 'stage1_source_diff_prepared');

  const nativeIds = domain.assessExactNativeIdNodeCandidates({
    oldNodes: oldAssessment.model.nodes,
    newNodes: newAssessment.model.nodes,
    sourceDiffRelocations: relocation.relocations,
  });
  metrics.nativeIdCandidates += nativeIds.candidates.length;
  for (const unmatched of nativeIds.unmatched) increment(metrics.nativeIdUnmatched, unmatched.reason);
  increment(metrics.pairFunnel, 'stage2_native_id_assessed');

  const scoring = domain.scoreFingerprintCandidates({
    candidateAssessment: nativeIds,
    oldFingerprints: oldAssessment.fingerprints.map((fingerprint, index) => ({
      nativeId: oldAssessment.model.nodes[index].nativeId,
      fingerprint,
    })),
    newFingerprints: newAssessment.fingerprints.map((fingerprint, index) => ({
      nativeId: newAssessment.model.nodes[index].nativeId,
      fingerprint,
    })),
  });
  metrics.fingerprintScoredCandidates += scoring.scored.length;
  for (const unresolved of scoring.unresolved) increment(metrics.fingerprintUnresolved, unresolved.reason);
  for (const candidate of scoring.scored) {
    const band = candidate.score >= 0.9 ? 'high' : candidate.score >= 0.65 ? 'medium' : 'low';
    increment(metrics.fingerprintScoreBands, band);
  }
  increment(metrics.pairFunnel, 'stage3_fingerprint_scored');

  const assignment = domain.assignMaximumWeightCandidates({ scored: scoring.scored });
  metrics.globalAssignmentsSelected += assignment.selected.length;
  for (const unresolved of assignment.unresolved) increment(metrics.globalAssignmentUnresolved, unresolved.reason);
  increment(metrics.pairFunnel, 'stage4_global_assignment_assessed');

  const topology = domain.assessStructuralTopology({
    oldModel: oldAssessment.model,
    newModel: newAssessment.model,
    globalAssignmentSelections: assignment.selected,
  });
  metrics.topologyAssessed += topology.assessed.length;
  for (const unresolved of topology.unresolved) increment(metrics.topologyUnresolved, unresolved.reason);
  increment(metrics.topologyIteration, topology.iteration.status);
  increment(metrics.pairFunnel, 'stage5_topology_assessed');

  const splitMerge = domain.assessSplitMergePatterns({
    scored: scoring.scored,
    globalAssignmentSelections: assignment.selected,
  });
  for (const pattern of splitMerge.patterns) increment(metrics.splitMergePatterns, pattern.status);
  for (const unresolved of splitMerge.unresolved) increment(metrics.splitMergeUnresolved, unresolved.reason);
  increment(metrics.pairFunnel, 'stage6_split_merge_assessed');

  const topologyByCandidate = new Map(
    topology.assessed.map((evidence) => [
      `${evidence.selection.candidate.candidate.old.nativeId}:${evidence.selection.candidate.candidate.new.nativeId}`,
      evidence,
    ]),
  );
  const policy = domain.classifyDeleteRecreateConfidence({
    evidence: scoring.scored.map((candidate) => ({
      candidate,
      topology: topologyByCandidate.get(`${candidate.candidate.old.nativeId}:${candidate.candidate.new.nativeId}`) ?? null,
      revisionDistance: revisionDistance(row.priorVersionNumber, row.currentVersionNumber),
    })),
  });
  for (const outcome of policy.outcomes) {
    increment(metrics.policyOutcomes, policyOutcomeBucket(outcome.outcome));
    for (const reason of outcome.reasons) increment(metrics.policyReasons, reason);
  }
  increment(metrics.pairFunnel, 'stage7_confidence_policy_assessed');

  return {
    kind: 'ok',
    relocation,
    nativeIds,
    scoring,
    assignment,
    topology,
    splitMerge,
    policy,
    transfer: null,
  };
}

function recordLocalAuditSpotCheck(spotChecks, row, result) {
  const oldSource = parseStoredBody(row.priorBody);
  const newSource = parseStoredBody(row.currentBody);
  const sources = oldSource.kind === 'ok' && newSource.kind === 'ok'
    ? { before: oldSource.code, after: newSource.code }
    : null;
  const categories = result.kind === 'ok'
    ? [
      'successful_static_ingestion',
      ...(result.relocation.relocations.length > 0 ? ['source_diff_relocation'] : []),
      ...(result.scoring.scored.some((candidate) =>
        candidate.components.some((component) => component.signal === 'normalized_label' && component.evidence === 'different')
      ) ? ['same_id_renamed_label'] : []),
      ...(result.assignment.unresolved.some((entry) => entry.reason === 'ambiguous_global_assignment_tie')
        || result.splitMerge.patterns.length > 0 ? ['ambiguous_assignment_or_split_merge'] : []),
      ...(result.policy.outcomes.some((outcome) => outcome.outcome === 'orphaned') ? ['orphan_delete_recreate'] : []),
    ]
    : ['unsupported_or_ineligible'];
  for (const category of categories) {
    if (spotChecks[category] || !sources) continue;
    spotChecks[category] = {
      sources,
      structural: result.kind === 'ok'
        ? {
          oldNodes: result.oldNodeCount,
          newNodes: result.newNodeCount,
          relocations: result.relocation.relocations.length,
          sourceDiffUnresolved: result.relocation.unresolved.map((entry) => entry.reason),
          nativeIdCandidates: result.nativeIds.candidates.length,
          nativeIdUnmatched: result.nativeIds.unmatched.map((entry) => entry.reason),
          scoredCandidates: result.scoring.scored.length,
          scoreBands: result.scoring.scored.map((candidate) => candidate.score >= 0.9 ? 'high' : candidate.score >= 0.65 ? 'medium' : 'low'),
          assignmentSelected: result.assignment.selected.length,
          assignmentUnresolved: result.assignment.unresolved.map((entry) => entry.reason),
          topologyAssessed: result.topology.assessed.length,
          topologyUnresolved: result.topology.unresolved.map((entry) => entry.reason),
          splitMerge: result.splitMerge.patterns.map((pattern) => pattern.status),
          policy: result.policy.outcomes.map((outcome) => ({ outcome: outcome.outcome, reasons: outcome.reasons })),
        }
        : { oldGate: result.oldKind, newGate: result.newKind },
    };
  }
}

function parseOptions(argv) {
  const options = {
    run: false,
    limit: DEFAULT_LIMIT,
    batchSize: DEFAULT_BATCH_SIZE,
    stateDir: DEFAULT_STATE_DIR,
    flowchartCandidates: false,
    historicalPairs: false,
    spotCheck: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') options.run = true;
    else if (arg === '--dry-run') options.run = false;
    else if (arg === '--limit') options.limit = Number(argv[++index]);
    else if (arg === '--batch-size') options.batchSize = Number(argv[++index]);
    else if (arg === '--state-dir') options.stateDir = argv[++index];
    else if (arg === '--flowchart-candidates') options.flowchartCandidates = true;
    else if (arg === '--historical-pairs') options.historicalPairs = true;
    else if (arg === '--spot-check') options.spotCheck = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_LIMIT) throw new Error(`--limit must be 1..${MAX_LIMIT}`);
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > MAX_BATCH_SIZE) throw new Error(`--batch-size must be 1..${MAX_BATCH_SIZE}`);
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const schema = queryD1("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('CustomContent', 'CustomContentVersion')");
  const counts = queryD1("SELECT COUNT(*) AS mermaid_contents FROM CustomContent WHERE diagramType = 'mermaid'");
  const versionCounts = queryD1("SELECT COUNT(*) AS custom_content_versions FROM CustomContentVersion");
  const historyCounts = queryD1("SELECT COUNT(*) AS mermaid_contents_with_prior FROM CustomContent c WHERE c.diagramType = 'mermaid' AND EXISTS (SELECT 1 FROM CustomContentVersion v WHERE v.contentId = c.contentId AND v.appId = c.appId AND v.versionNumber < c.latestVersionNumber)");
  const preflight = {
    mode: options.run ? (options.historicalPairs ? 'historical_pairs_run' : 'static_run') : 'dry_run',
    schemaTables: schema.map((row) => row.name).sort(),
    corpus: {
      ...(counts[0] ?? {}),
      ...(versionCounts[0] ?? {}),
      ...(historyCounts[0] ?? {}),
    },
  };
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
  const mode = options.historicalPairs ? 'historical_pairs' : 'static_current';
  if (resumed?.mode && resumed.mode !== mode) throw new Error('Checkpoint mode differs from this run; choose a separate --state-dir');
  if (resumed && mode === 'historical_pairs' && resumed.version !== 2) {
    throw new Error('Historical-pairs mode requires a version 2 checkpoint; choose a separate --state-dir');
  }
  const state = resumed ?? (mode === 'historical_pairs'
    ? {
      version: 2,
      mode,
      queryScope,
      currentOffset: 0,
      historicalOffset: 0,
      currentMetrics: newMetrics(),
      historicalMetrics: newHistoricalMetrics(),
      manualSpotCheck: {},
    }
    : { version: 1, mode, queryScope, offset: 0, metrics: newMetrics() });
  if (mode === 'static_current') migrateStaticFingerprintMetrics(state.metrics);
  const domain = await importDomain();

  const flowchartPredicate = options.flowchartCandidates
    ? " AND (body LIKE '%flowchart%' OR body LIKE '%graph%')"
    : '';
  const queryCurrent = (limit, offset) => queryD1(`SELECT contentId, appId, body FROM CustomContent WHERE diagramType = 'mermaid'${flowchartPredicate} ORDER BY createdAt DESC, contentId, appId LIMIT ${limit} OFFSET ${offset}`);

  if (mode === 'static_current') {
    while (state.offset < options.limit) {
      const remaining = options.limit - state.offset;
      const batchSize = Math.min(options.batchSize, remaining);
      const contents = queryCurrent(batchSize, state.offset);
      if (contents.length === 0) break;
      for (const content of contents) {
        state.metrics.contents += 1;
        await analyzeCurrentBody(content.body, state.metrics, domain);
      }
      state.offset += contents.length;
      await saveJson(stateFile, state);
    }
  } else {
    // Flow A: initial ingestion is a current-source-only sample. Historical
    // availability is not its prerequisite or denominator.
    while (state.currentOffset < options.limit) {
      const remaining = options.limit - state.currentOffset;
      const batchSize = Math.min(options.batchSize, remaining);
      const contents = queryCurrent(batchSize, state.currentOffset);
      if (contents.length === 0) break;
      for (const content of contents) {
        state.currentMetrics.contents += 1;
        await analyzeCurrentBody(content.body, state.currentMetrics, domain);
      }
      state.currentOffset += contents.length;
      await saveJson(stateFile, state);
    }

    // Flow B: only this separate pair sample enters change handling. The SQL
    // page is one guarded WITH/SELECT and returns bodies only to process memory.
    while (state.historicalOffset < options.limit) {
      const remaining = options.limit - state.historicalOffset;
      const batchSize = Math.min(options.batchSize, remaining);
      const pairs = queryD1(`WITH latest_prior AS (
  SELECT v.contentId, v.appId, v.body AS priorBody, v.versionNumber AS priorVersionNumber,
         ROW_NUMBER() OVER (
           PARTITION BY v.contentId, v.appId
           ORDER BY v.versionNumber DESC, v.createdAt DESC
         ) AS priorRank
  FROM CustomContentVersion v
  JOIN CustomContent c0 ON c0.contentId = v.contentId AND c0.appId = v.appId
  WHERE c0.diagramType = 'mermaid'
    AND v.versionNumber < c0.latestVersionNumber
    ${flowchartPredicate.replaceAll('body', 'c0.body')}
)
SELECT c.body AS currentBody,
       c.latestVersionNumber AS currentVersionNumber,
       p.priorBody,
       p.priorVersionNumber
FROM CustomContent c
JOIN latest_prior p
  ON p.contentId = c.contentId AND p.appId = c.appId AND p.priorRank = 1
WHERE c.diagramType = 'mermaid'
  ${flowchartPredicate}
ORDER BY c.createdAt DESC, c.contentId, c.appId
LIMIT ${batchSize} OFFSET ${state.historicalOffset}`);
      if (pairs.length === 0) break;
      for (const pair of pairs) {
        const result = await analyzeHistoricalPairRow(pair, state.historicalMetrics, domain);
        if (options.spotCheck) recordLocalAuditSpotCheck(state.manualSpotCheck, pair, result);
      }
      state.historicalOffset += pairs.length;
      await saveJson(stateFile, state);
    }
  }

  const safeguards = {
    d1Access: 'read_only_select_with_only',
    persistence: 'aggregate_checkpoint_and_report_only',
    sourceHandling: 'bodies_are_memory_only; no raw source, IDs, titles, tenants, native IDs, locators, or fingerprints persisted',
    canonicalStore: 'confluence_custom_content',
    mirrorCaveat: 'D1 is a best-effort mirror; missing rows are not proof that Confluence lacks a revision',
  };
  const evidenceQuality = {
    precisionRecall: 'not measured: no manual or external ground truth',
    semanticIdentityAccuracy: 'not measured: staged evidence is not a semantic identity label',
    productReadiness: 'not assessed: this is a bounded read-only mirror experiment',
    automaticIdentityTransfer: 'none: the harness never calls the product reconciler and never transfers a binding',
    cohortInterpretation: 'general and flowchart-text-prefiltered cohorts are separate; the latter is not prevalence',
    historyInterpretation: 'Flow B eligible pairs are a subset for change-handling evidence; history is not a Flow A denominator',
  };
  const report = mode === 'historical_pairs'
    ? {
      experiment: 'architecture_tokens_staged_flowchart_shadow_v2',
      generatedAt: new Date().toISOString(),
      corpus: preflight.corpus,
      sample: {
        scope: queryScope,
        mode,
        requestedCurrentContents: options.limit,
        processedCurrentContents: state.currentMetrics.contents,
        currentFinalOffset: state.currentOffset,
        requestedHistoricalPairs: options.limit,
        processedHistoricalPairs: state.historicalMetrics.pairRows,
        historicalFinalOffset: state.historicalOffset,
      },
      safeguards,
      phaseScope: {
        flowAInitialIngestion: 'current source only: public parse -> owned Flowchart parser -> canonical node occurrences -> UTF-8 locator audit -> static fingerprints; history is not required',
        flowBChangeHandling: 'separate current/prior pair subset: source diff -> native-ID candidate -> fingerprint score -> global assignment -> topology -> split/merge -> delete/recreate policy',
        supportedSource: 'Mermaid Flowchart nodes only; unsupported or unsafe syntax fails closed',
        noTransfer: 'all stages produce evidence or fail-closed classifications; no identity confirmation, token binding write, or binding transfer is reported',
      },
      evidenceQuality,
      initialStaticIngestion: { funnel: state.currentMetrics },
      changeHandling: { funnel: state.historicalMetrics },
    }
    : {
      experiment: 'architecture_tokens_static_flowchart_locator_audit_v1',
      generatedAt: new Date().toISOString(),
      corpus: preflight.corpus,
      sample: { scope: queryScope, requestedContents: options.limit, processedContents: state.metrics.contents, finalOffset: state.offset },
      safeguards,
      phaseScope: {
        staticLocator: 'single current Flowchart source only; source-derived UTF-8 node-occurrence spans and role/context round trips',
        parsing: 'public Mermaid parse plus owned canonical Flowchart subset, each reported separately',
        deferred: 'historical versions, reconciliation, retention, global matching, topology, and identity transfer are out of scope for this static mode',
      },
      evidenceQuality,
      metrics: state.metrics,
    };
  await saveJson(reportFile, report);
  const spotCheckAuditFile = options.spotCheck
    ? resolve(options.stateDir, 'spot-check-audit.json')
    : undefined;
  if (spotCheckAuditFile) {
    await saveJson(spotCheckAuditFile, {
      localOnly: true,
      containsSource: true,
      warning: 'Private local audit artifact: do not commit, push, upload, or share outside approved internal review.',
      noCustomerIdentifiers: 'Database content/account identifiers are deliberately excluded.',
      categories: state.manualSpotCheck,
      absentCategories: [
        'ambiguous_assignment_or_split_merge',
        'orphan_delete_recreate',
      ].filter((category) => state.manualSpotCheck[category] == null),
    });
  }
  console.log(JSON.stringify({
    ...preflight,
    report: reportFile,
    sample: report.sample,
    metrics: report.metrics ?? {
      initialStaticIngestion: report.initialStaticIngestion?.funnel,
      changeHandling: report.changeHandling?.funnel,
    },
    spotCheckAudit: spotCheckAuditFile,
  }, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Shadow experiment failed: ${error.message}`);
    process.exitCode = 1;
  });
}
