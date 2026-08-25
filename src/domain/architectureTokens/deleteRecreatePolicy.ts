import type { FingerprintScoreComponent, FingerprintScoredCandidate } from './fingerprintScoring';

export type RevisionDistanceEvidence = 'adjacent' | 'non_adjacent' | 'unavailable';

export type DeleteRecreatePolicyOutcome = Readonly<{
  candidate: FingerprintScoredCandidate;
  outcome:
    | 'orphaned'
    | 'unresolved_insufficient_evidence'
    | 'unresolved_low_confidence'
    | 'requires_human_confirmation';
  confidenceBand: 'high' | 'medium' | 'low' | 'unavailable';
  reasons: readonly (
    | 'invalid_or_absent_score'
    | 'missing_label_evidence'
    | 'missing_container_evidence'
    | 'missing_topology_evidence'
    | 'missing_revision_distance'
    | 'invalid_topology_evidence'
    | 'same_native_id_is_insufficient'
    | 'label_changed'
    | 'container_changed'
    | 'topology_changed'
    | 'non_adjacent_revision'
    | 'confidence_not_identity_confirmation'
    | 'medium_confidence_requires_human_confirmation'
    | 'score_below_suggestion_band'
  )[];
}>;

export interface DeleteRecreatePolicyAssessment {
  readonly outcomes: readonly DeleteRecreatePolicyOutcome[];
}

/**
 * Applies the delete/recreate and confidence policy to staged evidence only.
 * It deliberately has no accepted/confirmed result and never alters a binding.
 */
export function classifyDeleteRecreateConfidence(input: Readonly<{
  evidence: readonly Readonly<{
    candidate: FingerprintScoredCandidate;
    topology: Readonly<{ topologySimilarity: number }> | null;
    revisionDistance: RevisionDistanceEvidence;
  }>[];
}>): DeleteRecreatePolicyAssessment {
  return {
    outcomes: input.evidence
      .map(classifyEvidence)
      .sort((left, right) => compareCandidates(left.candidate, right.candidate)),
  };
}

function classifyEvidence(evidence: Readonly<{
  candidate: FingerprintScoredCandidate;
  topology: Readonly<{ topologySimilarity: number }> | null;
  revisionDistance: RevisionDistanceEvidence;
}>): DeleteRecreatePolicyOutcome {
  const { candidate } = evidence;
  if (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 1) {
    return outcome(candidate, 'unresolved_insufficient_evidence', 'unavailable', ['invalid_or_absent_score']);
  }

  const label = componentEvidence(candidate, 'normalized_label');
  const container = componentEvidence(candidate, 'container_path');
  const missingReasons = missingEvidenceReasons(label, container, evidence.topology, evidence.revisionDistance);
  const confidenceBand = confidenceBandFor(candidate.score);
  if (missingReasons.length > 0) {
    return outcome(candidate, 'unresolved_insufficient_evidence', confidenceBand, missingReasons);
  }

  const sameNativeId = candidate.candidate.old.nativeId === candidate.candidate.new.nativeId;
  const identityBreak = sameNativeId
    && label === 'different'
    && container === 'different'
    && evidence.topology?.topologySimilarity === 0
    && evidence.revisionDistance === 'non_adjacent';
  if (identityBreak) {
    return outcome(candidate, 'orphaned', confidenceBand, [
      'same_native_id_is_insufficient',
      'label_changed',
      'container_changed',
      'topology_changed',
      'non_adjacent_revision',
    ]);
  }

  if (confidenceBand === 'low') {
    return outcome(candidate, 'unresolved_low_confidence', confidenceBand, ['score_below_suggestion_band']);
  }
  return outcome(candidate, 'requires_human_confirmation', confidenceBand, [
    ...(sameNativeId ? ['same_native_id_is_insufficient'] as const : []),
    confidenceBand === 'high'
      ? 'confidence_not_identity_confirmation'
      : 'medium_confidence_requires_human_confirmation',
  ]);
}

function componentEvidence(
  candidate: FingerprintScoredCandidate,
  signal: 'normalized_label' | 'container_path',
): FingerprintScoreComponent['evidence'] | null {
  const components = candidate.components.filter((component) => component.signal === signal);
  return components.length === 1 ? components[0].evidence : null;
}

function missingEvidenceReasons(
  label: FingerprintScoreComponent['evidence'] | null,
  container: FingerprintScoreComponent['evidence'] | null,
  topology: Readonly<{ topologySimilarity: number }> | null,
  revisionDistance: RevisionDistanceEvidence,
): DeleteRecreatePolicyOutcome['reasons'] {
  const reasons: DeleteRecreatePolicyOutcome['reasons'] = [];
  if (label === null || label === 'unavailable') reasons.push('missing_label_evidence');
  if (container === null || container === 'unavailable') reasons.push('missing_container_evidence');
  if (topology === null) reasons.push('missing_topology_evidence');
  else if (!Number.isFinite(topology.topologySimilarity) || topology.topologySimilarity < 0 || topology.topologySimilarity > 1) {
    reasons.push('invalid_topology_evidence');
  }
  if (revisionDistance === 'unavailable') reasons.push('missing_revision_distance');
  return reasons;
}

function confidenceBandFor(score: number): DeleteRecreatePolicyOutcome['confidenceBand'] {
  if (score >= 0.9) return 'high';
  if (score >= 0.65) return 'medium';
  return 'low';
}

function outcome(
  candidate: FingerprintScoredCandidate,
  policyOutcome: DeleteRecreatePolicyOutcome['outcome'],
  confidenceBand: DeleteRecreatePolicyOutcome['confidenceBand'],
  reasons: DeleteRecreatePolicyOutcome['reasons'],
): DeleteRecreatePolicyOutcome {
  return { candidate, outcome: policyOutcome, confidenceBand, reasons };
}

function compareCandidates(left: FingerprintScoredCandidate, right: FingerprintScoredCandidate): number {
  return left.candidate.old.nativeId.localeCompare(right.candidate.old.nativeId)
    || left.candidate.new.nativeId.localeCompare(right.candidate.new.nativeId);
}
