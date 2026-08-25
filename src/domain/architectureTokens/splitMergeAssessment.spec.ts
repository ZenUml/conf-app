import { describe, expect, it } from 'vitest';
import { assessSplitMergePatterns } from './splitMergeAssessment';
import type { FingerprintScoredCandidate } from './fingerprintScoring';
import type { GlobalAssignmentSelection } from './globalAssignment';

describe('assessSplitMergePatterns', () => {
  it('classifies one old node with multiple medium-score new candidates as an ambiguous split', () => {
    const profile = scored('UserService', 'ProfileService', 0.69);
    const credential = scored('UserService', 'CredentialService', 0.66);
    const result = assessSplitMergePatterns({
      scored: [profile, credential],
      globalAssignmentSelections: [selection(profile)],
    });

    expect(result.patterns).toEqual([expect.objectContaining({
      kind: 'split',
      status: 'ambiguous_split',
      oldNativeIds: ['UserService'],
      newNativeIds: ['CredentialService', 'ProfileService'],
      candidates: [credential, profile],
      relatedGlobalAssignmentSelections: [expect.objectContaining({ candidate: profile })],
      requiredAction: 'human_confirmation',
    })]);
    expect(result.unresolved).toEqual([]);
  });

  it('classifies multiple old nodes with one medium-score new candidate as an ambiguous merge', () => {
    const profile = scored('ProfileService', 'UserService', 0.69);
    const credential = scored('CredentialService', 'UserService', 0.66);
    const result = assessSplitMergePatterns({
      scored: [profile, credential],
      globalAssignmentSelections: [selection(profile)],
    });

    expect(result.patterns).toEqual([expect.objectContaining({
      kind: 'merge',
      status: 'ambiguous_merge',
      oldNativeIds: ['CredentialService', 'ProfileService'],
      newNativeIds: ['UserService'],
      candidates: [credential, profile],
      requiredAction: 'human_confirmation',
    })]);
    expect(result.unresolved).toEqual([]);
  });

  it('fails closed when duplicate medium-score edges make a split input ambiguous', () => {
    const profile = scored('UserService', 'ProfileService', 0.69);
    const credential = scored('UserService', 'CredentialService', 0.66);
    const result = assessSplitMergePatterns({
      scored: [profile, profile, credential],
      globalAssignmentSelections: [],
    });

    expect(result.patterns).toEqual([]);
    expect(result.unresolved).toEqual([
      expect.objectContaining({ candidate: profile, reason: 'duplicate_scored_candidate_edge' }),
      expect.objectContaining({ candidate: profile, reason: 'duplicate_scored_candidate_edge' }),
    ]);
  });
});

function scored(oldNativeId: string, newNativeId: string, score: number): FingerprintScoredCandidate {
  return {
    candidate: {
      old: { kind: 'node', nativeId: oldNativeId },
      new: { kind: 'node', nativeId: newNativeId },
      sourceDiffRelocations: [],
      nextRequiredGate: 'fingerprint_scoring',
    },
    components: [],
    score,
    availableWeight: 1,
    statementContextEvidence: 'unavailable',
    sourceDiffRelocationEvidence: 'absent',
    nextRequiredGate: 'global_assignment',
  };
}

function selection(candidate: FingerprintScoredCandidate): GlobalAssignmentSelection {
  return {
    candidate,
    proof: 'unique_maximum_weight_assignment',
    componentMaximumScore: candidate.score,
    componentCandidateCount: 1,
    nextRequiredGate: 'structural_topology_assessment',
  };
}
