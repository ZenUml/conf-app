import type { FingerprintScoredCandidate } from './fingerprintScoring';
import type { GlobalAssignmentSelection } from './globalAssignment';

const MEDIUM_SCORE_MIN = 0.65;
const MEDIUM_SCORE_MAX_EXCLUSIVE = 0.9;

export type SplitMergePattern = Readonly<{
  kind: 'split' | 'merge';
  status: 'ambiguous_split' | 'ambiguous_merge';
  oldNativeIds: readonly string[];
  newNativeIds: readonly string[];
  candidates: readonly FingerprintScoredCandidate[];
  /** Gate 4 evidence is retained for audit, never treated as a binding action. */
  relatedGlobalAssignmentSelections: readonly GlobalAssignmentSelection[];
  evidence: 'multiple_medium_score_candidates';
  requiredAction: 'human_confirmation';
}>;

export type SplitMergeUnresolved = Readonly<{
  candidate: FingerprintScoredCandidate;
  reason: 'invalid_or_absent_score' | 'duplicate_scored_candidate_edge';
}>;

export interface SplitMergeAssessment {
  readonly patterns: readonly SplitMergePattern[];
  readonly unresolved: readonly SplitMergeUnresolved[];
}

/**
 * Detects only the authoritative 1→many / many→1 medium-score patterns.
 * A detected pattern is deliberately ambiguous and never selects, confirms,
 * transfers, or retains a binding.
 */
export function assessSplitMergePatterns(input: Readonly<{
  scored: readonly FingerprintScoredCandidate[];
  globalAssignmentSelections: readonly GlobalAssignmentSelection[];
}>): SplitMergeAssessment {
  const unresolved: SplitMergeUnresolved[] = [];
  const mediumCandidates: FingerprintScoredCandidate[] = [];
  const counts = new Map<string, number>();

  for (const candidate of input.scored) {
    if (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 1) {
      unresolved.push({ candidate, reason: 'invalid_or_absent_score' });
      continue;
    }
    if (candidate.score >= MEDIUM_SCORE_MIN && candidate.score < MEDIUM_SCORE_MAX_EXCLUSIVE) {
      const key = candidateKey(candidate);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      mediumCandidates.push(candidate);
    }
  }
  const duplicateKeys = new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
  const uniqueMediumCandidates = mediumCandidates.filter((candidate) => {
    if (!duplicateKeys.has(candidateKey(candidate))) return true;
    unresolved.push({ candidate, reason: 'duplicate_scored_candidate_edge' });
    return false;
  });

  const patterns = [
    ...groupPatterns('split', uniqueMediumCandidates, input.globalAssignmentSelections),
    ...groupPatterns('merge', uniqueMediumCandidates, input.globalAssignmentSelections),
  ];
  return {
    patterns: patterns.sort(comparePatterns),
    unresolved: unresolved.sort((left, right) => compareCandidates(left.candidate, right.candidate)),
  };
}

function groupPatterns(
  kind: SplitMergePattern['kind'],
  candidates: readonly FingerprintScoredCandidate[],
  selections: readonly GlobalAssignmentSelection[],
): readonly SplitMergePattern[] {
  const groups = new Map<string, FingerprintScoredCandidate[]>();
  for (const candidate of candidates) {
    const key = kind === 'split' ? candidate.candidate.old.nativeId : candidate.candidate.new.nativeId;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([sharedId, group]) => {
      const sortedCandidates = [...group].sort(compareCandidates);
      const candidateKeys = new Set(sortedCandidates.map(candidateKey));
      return {
        kind,
        status: kind === 'split' ? 'ambiguous_split' : 'ambiguous_merge',
        oldNativeIds: kind === 'split'
          ? [sharedId]
          : sortedCandidates.map((candidate) => candidate.candidate.old.nativeId).sort(),
        newNativeIds: kind === 'merge'
          ? [sharedId]
          : sortedCandidates.map((candidate) => candidate.candidate.new.nativeId).sort(),
        candidates: sortedCandidates,
        relatedGlobalAssignmentSelections: selections
          .filter((selection) => candidateKeys.has(candidateKey(selection.candidate)))
          .sort(compareSelections),
        evidence: 'multiple_medium_score_candidates',
        requiredAction: 'human_confirmation',
      };
    });
}

function candidateKey(candidate: FingerprintScoredCandidate): string {
  return JSON.stringify([candidate.candidate.old.nativeId, candidate.candidate.new.nativeId]);
}

function compareCandidates(left: FingerprintScoredCandidate, right: FingerprintScoredCandidate): number {
  return left.candidate.old.nativeId.localeCompare(right.candidate.old.nativeId)
    || left.candidate.new.nativeId.localeCompare(right.candidate.new.nativeId);
}

function compareSelections(left: GlobalAssignmentSelection, right: GlobalAssignmentSelection): number {
  return compareCandidates(left.candidate, right.candidate);
}

function comparePatterns(left: SplitMergePattern, right: SplitMergePattern): number {
  return left.kind.localeCompare(right.kind)
    || left.oldNativeIds.join('\u0000').localeCompare(right.oldNativeIds.join('\u0000'))
    || left.newNativeIds.join('\u0000').localeCompare(right.newNativeIds.join('\u0000'));
}
