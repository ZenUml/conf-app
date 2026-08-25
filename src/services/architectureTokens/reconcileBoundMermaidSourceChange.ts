import {
  type ArchitectureTokenBindingStateV1,
  type BindingAuditRecord,
  type RevisionElementRecord,
} from '@/domain/architectureTokens/architectureTokenBindingState';
import { classifyDeleteRecreateConfidence } from '@/domain/architectureTokens/deleteRecreatePolicy';
import { fingerprintStaticFlowchartNode, type StaticFlowchartNodeFingerprint } from '@/domain/architectureTokens/flowchartStaticFingerprint';
import { scoreFingerprintCandidates } from '@/domain/architectureTokens/fingerprintScoring';
import { assignMaximumWeightCandidates } from '@/domain/architectureTokens/globalAssignment';
import { type CanonicalFlowchart, type CanonicalNode } from '@/domain/architectureTokens/mermaidFlowchart';
import { assessExactNativeIdNodeCandidates } from '@/domain/architectureTokens/nativeIdCandidate';
import { sha256NormalizedSource } from '@/domain/architectureTokens/sourceRevision';
import { prepareSourceDiffRelocation } from '@/domain/architectureTokens/sourceDiffRelocation';
import { assessSplitMergePatterns } from '@/domain/architectureTokens/splitMergeAssessment';
import { assessStructuralTopology } from '@/domain/architectureTokens/structuralTopologyAssessment';
import { validateMermaidFlowchart, type ValidatedFlowchartResult } from '@/domain/architectureTokens/validateMermaidFlowchart';
import { buildCurrentRevisionState, type MermaidStaticIngestionDependencies } from './prepareMermaidStaticIngestion';

const POLICY_VERSION = 'architecture-token-binding-v1';

export type BoundMermaidReconciliationResult =
  | Readonly<{ kind: 'reconciled'; state: ArchitectureTokenBindingStateV1; outcome: 'accepted' | 'unresolved' }>
  | Readonly<{ kind: 'unavailable'; reason: 'loaded_source_hash_mismatch' | 'old_source_invalid' | 'old_source_unsupported' }>;

/**
 * Confluence-first save-time reconciliation orchestration. It consumes a
 * session-only source snapshot and only writes a new binding target after the
 * strongest source-address proof: every stored occurrence relocates exactly to
 * one unique canonical node and that node's static fingerprint is unchanged.
 *
 * The other staged modules are still run and summarized as audit evidence.
 * They intentionally cannot promote a binding: native IDs, scores, assignment,
 * topology, split/merge, and policy output remain evidence-only here.
 */
export async function reconcileBoundMermaidSourceChange(input: Readonly<{
  previousState: ArchitectureTokenBindingStateV1;
  previousSource: string;
  nextSource: string;
  nextValidation: Extract<ValidatedFlowchartResult, { kind: 'ok' }>;
  dependencies: MermaidStaticIngestionDependencies;
}>): Promise<BoundMermaidReconciliationResult> {
  const current = input.previousState.revisions.find((revision) => revision.sourceRevisionId === input.previousState.currentRevisionId);
  if (!current || current.validationStatus !== 'valid') return { kind: 'unavailable', reason: 'loaded_source_hash_mismatch' };
  if (await sha256NormalizedSource(input.previousSource) !== current.normalizedSourceSha256) {
    return { kind: 'unavailable', reason: 'loaded_source_hash_mismatch' };
  }

  const previousValidation = await (input.dependencies.validate ?? validateMermaidFlowchart)(input.previousSource);
  if (previousValidation.kind === 'invalid') return { kind: 'unavailable', reason: 'old_source_invalid' };
  if (previousValidation.kind === 'unsupported') return { kind: 'unavailable', reason: 'old_source_unsupported' };

  const relocation = prepareSourceDiffRelocation({
    oldSource: input.previousSource,
    newSource: input.nextSource,
    oldLocators: input.previousState.revisionElements
      .filter((entry) => entry.sourceRevisionId === input.previousState.currentRevisionId)
      .flatMap((entry) => entry.locators.map((locator) => ({
        locatorId: locator.locatorId,
        span: { startByte: locator.spanStartByte, endByte: locator.spanEndByte },
      }))),
  });
  const candidates = assessExactNativeIdNodeCandidates({
    oldNodes: previousValidation.model.nodes,
    newNodes: input.nextValidation.model.nodes,
    sourceDiffRelocations: relocation.relocations,
  });
  const scoring = scoreFingerprintCandidates({
    candidateAssessment: candidates,
    oldFingerprints: staticFactsFromStored(input.previousState, previousValidation.model),
    newFingerprints: input.nextValidation.model.nodes.map((node) => ({ nativeId: node.nativeId, fingerprint: fingerprintStaticFlowchartNode(node) })),
  });
  const assignment = assignMaximumWeightCandidates({ scored: scoring.scored });
  const topology = assessStructuralTopology({
    oldModel: previousValidation.model,
    newModel: input.nextValidation.model,
    globalAssignmentSelections: assignment.selected,
  });
  const splitMerge = assessSplitMergePatterns({
    scored: scoring.scored,
    globalAssignmentSelections: assignment.selected,
  });
  const topologyByCandidate = new Map(topology.assessed.map((item) => [candidateKey(item.selection.candidate.candidate), item]));
  const policy = classifyDeleteRecreateConfidence({
    evidence: scoring.scored.map((candidate) => ({
      candidate,
      topology: topologyByCandidate.get(candidateKey(candidate.candidate)) ?? null,
      // Diagram bodies do not carry an authoritative Confluence version number
      // in this product seam. The policy consequently stays fail-closed.
      revisionDistance: 'unavailable' as const,
    })),
  });

  const createId = input.dependencies.createId ?? (() => crypto.randomUUID());
  const now = input.dependencies.now ?? (() => new Date().toISOString());
  const nextHash = await sha256NormalizedSource(input.nextSource);
  const nextStatic = buildCurrentRevisionState(
    input.nextValidation.model,
    input.nextValidation.locatorEvidence.kind,
    nextHash,
    current.sourceId,
    createId,
    now,
  );
  const nextRevision = nextStatic.revisions[0];
  const nextStateWithParent = {
    ...nextStatic,
    revisions: [{ ...nextRevision, parentSourceRevisionId: current.sourceRevisionId }],
  } as ArchitectureTokenBindingStateV1;
  const safeTargets = exactRelocationTargets({
    previousState: input.previousState,
    oldModel: previousValidation.model,
    newModel: input.nextValidation.model,
    relocations: relocation.relocations,
  });
  const newElementIdByNativeId = uniqueNewElementIds(nextStateWithParent);
  const orphanedOldNativeIds = new Set(policy.outcomes
    .filter((outcome) => outcome.outcome === 'orphaned')
    .map((outcome) => outcome.candidate.candidate.old.nativeId));

  const updatedBindings = input.previousState.bindings.map((binding) => {
    const oldEntry = input.previousState.revisionElements.find((entry) => entry.diagramElementId === binding.diagramElementId);
    const oldNativeId = oldEntry?.fingerprint.nativeId;
    const targetNativeId = binding.status === 'confirmed' && oldNativeId ? safeTargets.get(binding.diagramElementId) : undefined;
    const targetElementId = targetNativeId ? newElementIdByNativeId.get(targetNativeId) : undefined;
    if (targetElementId) {
      return {
        ...binding,
        diagramElementId: targetElementId,
        status: 'confirmed' as const,
        confirmationMethod: 'reconciliation' as const,
        updatedAt: now(),
        provenance: { source: 'reconciliation' as const, recordedAt: now() },
      };
    }
    const status = binding.status === 'orphaned' || (oldNativeId && orphanedOldNativeIds.has(oldNativeId))
      ? 'orphaned' as const
      : 'unresolved' as const;
    return { ...binding, status, updatedAt: now() };
  });

  const retainedOldElementIds = new Set(updatedBindings.map((binding) => binding.diagramElementId)
    .filter((elementId) => !nextStateWithParent.elements.some((element) => element.diagramElementId === elementId)));
  const priorElements = input.previousState.elements
    .filter((element) => retainedOldElementIds.has(element.diagramElementId))
    .map((element) => ({
      ...element,
      lifecycleStatus: updatedBindings.some((binding) => binding.diagramElementId === element.diagramElementId && binding.status === 'orphaned')
        ? 'orphaned' as const
        : 'unresolved' as const,
    }));
  const priorRevisionElements = input.previousState.revisionElements.filter((entry) => retainedOldElementIds.has(entry.diagramElementId));
  const retainedRevisionIds = new Set([
    ...priorElements.map((element) => element.createdInRevisionId),
    ...priorRevisionElements.map((entry) => entry.sourceRevisionId),
    nextStateWithParent.currentRevisionId,
  ]);
  const priorRevisions = input.previousState.revisions.filter((revision) => retainedRevisionIds.has(revision.sourceRevisionId));
  const priorAudit = input.previousState.audit.filter((audit) => retainedRevisionIds.has(audit.sourceRevisionId));
  const unresolvedCount = updatedBindings.filter((binding) => binding.status !== 'confirmed').length;
  const audit: BindingAuditRecord = {
    auditId: `audit-${createId()}`,
    kind: 'reconciliation',
    sourceRevisionId: nextStateWithParent.currentRevisionId,
    outcome: unresolvedCount === 0 ? 'accepted' : 'unresolved',
    reasons: reconciliationReasons({ relocation, candidates, scoring, assignment, topology, splitMerge, policy, retained: updatedBindings.length - unresolvedCount }),
    algorithmVersion: POLICY_VERSION,
    recordedAt: now(),
  };

  return {
    kind: 'reconciled',
    outcome: audit.outcome === 'accepted' ? 'accepted' : 'unresolved',
    state: {
      ...nextStateWithParent,
      revisions: [...priorRevisions, ...nextStateWithParent.revisions],
      elements: [...priorElements, ...nextStateWithParent.elements],
      revisionElements: [...priorRevisionElements, ...nextStateWithParent.revisionElements],
      bindings: updatedBindings,
      audit: [...priorAudit, audit],
    },
  };
}

function staticFactsFromStored(state: ArchitectureTokenBindingStateV1, model: CanonicalFlowchart) {
  const currentEntries = state.revisionElements.filter((entry) => entry.sourceRevisionId === state.currentRevisionId);
  return model.nodes.flatMap((node) => {
    const entries = currentEntries.filter((entry) => entry.fingerprint.nativeId === node.nativeId);
    return entries.length === 1 ? [{ nativeId: node.nativeId, fingerprint: fingerprintFromStored(entries[0]) }] : [];
  });
}

function fingerprintFromStored(entry: RevisionElementRecord): StaticFlowchartNodeFingerprint {
  const fingerprint = entry.fingerprint;
  return {
    fingerprintVersion: fingerprint.fingerprintVersion,
    provenance: 'single_revision_static',
    syntax: {
      kind: 'node',
      nativeId: fingerprint.nativeId,
      normalizedLabel: fingerprint.normalizedLabel,
      shape: fingerprint.shape,
      canonicalSyntaxKey: JSON.stringify({
        fingerprintVersion: fingerprint.fingerprintVersion,
        kind: 'node',
        nativeId: fingerprint.nativeId,
        shape: fingerprint.shape,
        normalizedLabel: fingerprint.normalizedLabel,
      }),
    },
    structural: {
      containerPath: fingerprint.containerPath,
      statementContexts: fingerprint.statementContexts,
      incidentNeighborNativeIds: fingerprint.neighborNativeIds,
    },
  };
}

function exactRelocationTargets(input: Readonly<{
  previousState: ArchitectureTokenBindingStateV1;
  oldModel: CanonicalFlowchart;
  newModel: CanonicalFlowchart;
  relocations: readonly Readonly<{ locatorId: string; newSpan: Readonly<{ startByte: number; endByte: number }> }> [];
}>): ReadonlyMap<string, string> {
  const oldEntries = input.previousState.revisionElements.filter((entry) => entry.sourceRevisionId === input.previousState.currentRevisionId);
  const relocationByLocator = new Map(input.relocations.map((relocation) => [relocation.locatorId, relocation]));
  const targets = new Map<string, string>();
  for (const entry of oldEntries) {
    const oldNode = uniqueNode(input.oldModel.nodes, entry.fingerprint.nativeId);
    const newNode = uniqueNode(input.newModel.nodes, entry.fingerprint.nativeId);
    const entriesForNativeId = oldEntries.filter((candidate) => candidate.fingerprint.nativeId === entry.fingerprint.nativeId);
    if (entriesForNativeId.length !== 1 || !oldNode || !newNode || !storedLocatorSetMatchesNode(entry, oldNode) || !fingerprintEquals(entry, newNode)) continue;
    if (entry.locators.length !== newNode.occurrences.length) continue;
    const relocatedOccurrences = entry.locators.flatMap((locator) => {
      const relocation = relocationByLocator.get(locator.locatorId);
      return relocation ? [{
        role: locator.occurrenceRole,
        startByte: relocation.newSpan.startByte,
        endByte: relocation.newSpan.endByte,
      }] : [];
    });
    if (relocatedOccurrences.length !== entry.locators.length || !occurrenceSpansEqual(relocatedOccurrences, newNode)) continue;
    targets.set(entry.diagramElementId, newNode.nativeId);
  }
  return targets;
}

function uniqueNode(nodes: readonly CanonicalNode[], nativeId: string): CanonicalNode | null {
  const matches = nodes.filter((node) => node.nativeId === nativeId);
  return matches.length === 1 ? matches[0] : null;
}

function storedLocatorSetMatchesNode(entry: RevisionElementRecord, node: CanonicalNode): boolean {
  const stored = entry.locators.map((locator) => [
    locator.occurrenceRole,
    locator.spanStartByte,
    locator.spanEndByte,
    locator.statementSpanStartByte,
    locator.statementSpanEndByte,
  ].join(':')).sort();
  const canonical = node.occurrences.map((occurrence) => [
    occurrence.role,
    occurrence.span.startByte,
    occurrence.span.endByte,
    occurrence.statementSpan.startByte,
    occurrence.statementSpan.endByte,
  ].join(':')).sort();
  return arraysEqual(stored, canonical);
}

function occurrenceSpansEqual(
  relocated: readonly Readonly<{ role: string; startByte: number; endByte: number }>[],
  node: CanonicalNode,
): boolean {
  const relocatedKeys = relocated.map((occurrence) => [occurrence.role, occurrence.startByte, occurrence.endByte].join(':')).sort();
  const canonicalKeys = node.occurrences.map((occurrence) => [occurrence.role, occurrence.span.startByte, occurrence.span.endByte].join(':')).sort();
  return arraysEqual(relocatedKeys, canonicalKeys);
}

function fingerprintEquals(entry: RevisionElementRecord, node: CanonicalNode): boolean {
  const facts = fingerprintStaticFlowchartNode(node);
  const fingerprint = entry.fingerprint;
  return fingerprint.nativeId === facts.syntax.nativeId
    && fingerprint.normalizedLabel === facts.syntax.normalizedLabel
    && fingerprint.shape === facts.syntax.shape
    && arraysEqual(fingerprint.containerPath, facts.structural.containerPath)
    && arraysEqual(fingerprint.statementContexts, facts.structural.statementContexts)
    && arraysEqual(fingerprint.neighborNativeIds, facts.structural.incidentNeighborNativeIds);
}

function uniqueNewElementIds(state: ArchitectureTokenBindingStateV1): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const entry of state.revisionElements) {
    if (values.has(entry.fingerprint.nativeId)) duplicates.add(entry.fingerprint.nativeId);
    else values.set(entry.fingerprint.nativeId, entry.diagramElementId);
  }
  for (const duplicate of duplicates) values.delete(duplicate);
  return values;
}

function reconciliationReasons(input: Readonly<{
  relocation: ReturnType<typeof prepareSourceDiffRelocation>;
  candidates: ReturnType<typeof assessExactNativeIdNodeCandidates>;
  scoring: ReturnType<typeof scoreFingerprintCandidates>;
  assignment: ReturnType<typeof assignMaximumWeightCandidates>;
  topology: ReturnType<typeof assessStructuralTopology>;
  splitMerge: ReturnType<typeof assessSplitMergePatterns>;
  policy: ReturnType<typeof classifyDeleteRecreateConfidence>;
  retained: number;
}>): readonly string[] {
  const reasons = new Set<string>();
  if (input.retained > 0) {
    reasons.add('exact_source_relocation_all_occurrences');
    reasons.add('static_fingerprint_exact');
    reasons.add('binding_retained');
  }
  if (input.retained === 0) reasons.add('no_safe_exact_relocation');
  if (input.relocation.unresolved.length > 0) reasons.add('source_diff_unresolved');
  if (input.candidates.unmatched.length > 0) reasons.add('native_id_unmatched');
  if (input.scoring.unresolved.length > 0) reasons.add('fingerprint_unresolved');
  if (input.assignment.unresolved.length > 0) reasons.add('assignment_unresolved');
  if (input.topology.unresolved.length > 0) reasons.add('topology_unresolved');
  if (input.splitMerge.patterns.length > 0) reasons.add('ambiguous_split_merge');
  if (input.policy.outcomes.some((outcome) => outcome.outcome === 'orphaned')) reasons.add('delete_recreate_orphaned');
  return [...reasons].sort();
}

function candidateKey(candidate: Readonly<{ old: Readonly<{ nativeId: string }>; new: Readonly<{ nativeId: string }> }>): string {
  return JSON.stringify([candidate.old.nativeId, candidate.new.nativeId]);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
