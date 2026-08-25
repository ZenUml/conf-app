import type { StaticFlowchartNodeFingerprint } from './flowchartStaticFingerprint';
import type { ExactNativeIdCandidateAssessment, ExactNativeIdNodeCandidate, UnmatchedNativeIdNode } from './nativeIdCandidate';

export type StaticFingerprintFact = Readonly<{
  nativeId: string;
  fingerprint: StaticFlowchartNodeFingerprint;
}>;

export type FingerprintScoreComponent = Readonly<{
  signal: 'native_id' | 'kind' | 'normalized_label' | 'shape' | 'neighborhood' | 'container_path';
  weight: number;
  value: number;
  weightedScore: number;
  evidence: 'exact' | 'different' | 'raw_native_id_jaccard' | 'unavailable';
}>;

export type FingerprintScoredCandidate = Readonly<{
  candidate: ExactNativeIdNodeCandidate;
  components: readonly FingerprintScoreComponent[];
  /** Weighted static evidence, not a continuity or binding decision. */
  score: number;
  availableWeight: number;
  statementContextEvidence: 'exact' | 'different' | 'unavailable';
  sourceDiffRelocationEvidence: 'present' | 'absent';
  nextRequiredGate: 'global_assignment';
}>;

export type FingerprintScoringUnresolved = Readonly<{
  old: Readonly<{ kind: 'node'; nativeId: string }>;
  reason:
    | 'stage2_no_exact_native_id_candidate'
    | 'stage2_duplicate_native_id_candidate'
    | 'missing_old_static_fingerprint'
    | 'missing_new_static_fingerprint'
    | 'ambiguous_old_static_fingerprint'
    | 'ambiguous_new_static_fingerprint'
    | 'invalid_old_static_fingerprint'
    | 'invalid_new_static_fingerprint';
}>;

export interface FingerprintScoringAssessment {
  readonly scored: readonly FingerprintScoredCandidate[];
  readonly unresolved: readonly FingerprintScoringUnresolved[];
}

/**
 * Stage 3: scores only the exact-native-ID candidates emitted by Stage 2.
 * Scores describe static evidence and intentionally stop before global
 * assignment, topology iteration, identity confirmation, or binding changes.
 */
export function scoreFingerprintCandidates(input: Readonly<{
  candidateAssessment: ExactNativeIdCandidateAssessment;
  oldFingerprints: readonly StaticFingerprintFact[];
  newFingerprints: readonly StaticFingerprintFact[];
}>): FingerprintScoringAssessment {
  const scored: FingerprintScoredCandidate[] = [];
  const unresolved = input.candidateAssessment.unmatched.map(unresolvedFromStage2);

  for (const candidate of input.candidateAssessment.candidates) {
    const oldFingerprint = findFingerprint(input.oldFingerprints, candidate.old.nativeId, 'old');
    if ('reason' in oldFingerprint) {
      unresolved.push({ old: candidate.old, reason: oldFingerprint.reason });
      continue;
    }
    const newFingerprint = findFingerprint(input.newFingerprints, candidate.new.nativeId, 'new');
    if ('reason' in newFingerprint) {
      unresolved.push({ old: candidate.old, reason: newFingerprint.reason });
      continue;
    }

    const components = scoreComponents(oldFingerprint.fingerprint, newFingerprint.fingerprint);
    scored.push({
      candidate,
      components,
      score: round(components.reduce((total, component) => total + component.weightedScore, 0)),
      availableWeight: round(components
        .filter((component) => component.evidence !== 'unavailable')
        .reduce((total, component) => total + component.weight, 0)),
      statementContextEvidence: compareLists(
        oldFingerprint.fingerprint.structural.statementContexts,
        newFingerprint.fingerprint.structural.statementContexts,
      ),
      sourceDiffRelocationEvidence: candidate.sourceDiffRelocations.length > 0 ? 'present' : 'absent',
      nextRequiredGate: 'global_assignment',
    });
  }

  return { scored, unresolved };
}

function unresolvedFromStage2(unmatched: UnmatchedNativeIdNode): FingerprintScoringUnresolved {
  return {
    old: unmatched.old,
    reason: unmatched.reason === 'no_exact_native_id_candidate'
      ? 'stage2_no_exact_native_id_candidate'
      : 'stage2_duplicate_native_id_candidate',
  };
}

function findFingerprint(
  facts: readonly StaticFingerprintFact[],
  nativeId: string,
  revision: 'old' | 'new',
): Readonly<{ fingerprint: StaticFlowchartNodeFingerprint }> | Readonly<{ reason: FingerprintScoringUnresolved['reason'] }> {
  const candidates = facts.filter((fact) => fact.nativeId === nativeId);
  if (candidates.length === 0) return { reason: revision === 'old' ? 'missing_old_static_fingerprint' : 'missing_new_static_fingerprint' };
  if (candidates.length > 1) return { reason: revision === 'old' ? 'ambiguous_old_static_fingerprint' : 'ambiguous_new_static_fingerprint' };
  const fingerprint = candidates[0].fingerprint;
  if (
    fingerprint.fingerprintVersion !== 'flowchart_node_static_v1'
    || fingerprint.provenance !== 'single_revision_static'
    || fingerprint.syntax.kind !== 'node'
    || fingerprint.syntax.nativeId !== nativeId
  ) {
    return { reason: revision === 'old' ? 'invalid_old_static_fingerprint' : 'invalid_new_static_fingerprint' };
  }
  return { fingerprint };
}

function scoreComponents(
  oldFingerprint: StaticFlowchartNodeFingerprint,
  newFingerprint: StaticFlowchartNodeFingerprint,
): readonly FingerprintScoreComponent[] {
  return [
    exactComponent('native_id', 0.35, oldFingerprint.syntax.nativeId, newFingerprint.syntax.nativeId),
    exactComponent('kind', 0.2, oldFingerprint.syntax.kind, newFingerprint.syntax.kind),
    nullableComponent('normalized_label', 0.15, oldFingerprint.syntax.normalizedLabel, newFingerprint.syntax.normalizedLabel),
    nullableComponent('shape', 0.1, oldFingerprint.syntax.shape, newFingerprint.syntax.shape),
    neighborhoodComponent(oldFingerprint.structural.incidentNeighborNativeIds, newFingerprint.structural.incidentNeighborNativeIds),
    exactComponent('container_path', 0.05, oldFingerprint.structural.containerPath, newFingerprint.structural.containerPath),
  ];
}

function exactComponent(
  signal: 'native_id' | 'kind' | 'container_path',
  weight: number,
  left: string | readonly string[],
  right: string | readonly string[],
): FingerprintScoreComponent {
  const exact = Array.isArray(left) && Array.isArray(right)
    ? listsEqual(left, right)
    : left === right;
  return scoredComponent(signal, weight, exact ? 1 : 0, exact ? 'exact' : 'different');
}

function nullableComponent(
  signal: 'normalized_label' | 'shape',
  weight: number,
  left: string | null,
  right: string | null,
): FingerprintScoreComponent {
  if (left === null && right === null) return scoredComponent(signal, weight, 0, 'unavailable');
  return scoredComponent(signal, weight, left === right ? 1 : 0, left === right ? 'exact' : 'different');
}

function neighborhoodComponent(left: readonly string[], right: readonly string[]): FingerprintScoreComponent {
  if (left.length === 0 && right.length === 0) return scoredComponent('neighborhood', 0.15, 0, 'unavailable');
  const union = new Set([...left, ...right]);
  const intersection = [...new Set(left)].filter((value) => new Set(right).has(value));
  return scoredComponent('neighborhood', 0.15, intersection.length / union.size, 'raw_native_id_jaccard');
}

function scoredComponent(
  signal: FingerprintScoreComponent['signal'],
  weight: number,
  value: number,
  evidence: FingerprintScoreComponent['evidence'],
): FingerprintScoreComponent {
  return { signal, weight, value: round(value), weightedScore: round(weight * value), evidence };
}

function compareLists(left: readonly string[], right: readonly string[]): 'exact' | 'different' | 'unavailable' {
  if (left.length === 0 && right.length === 0) return 'unavailable';
  return listsEqual(left, right) ? 'exact' : 'different';
}

function listsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
