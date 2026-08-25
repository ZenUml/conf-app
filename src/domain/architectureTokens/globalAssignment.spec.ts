import { describe, expect, it } from 'vitest';
import { assignMaximumWeightCandidates } from './globalAssignment';
import type { FingerprintScoredCandidate } from './fingerprintScoring';

describe('assignMaximumWeightCandidates', () => {
  it('selects the unique globally optimal one-to-one assignment instead of greedy local scores', () => {
    const result = assignMaximumWeightCandidates({
      scored: [
        scored('A', 'A', 0.9),
        scored('A', 'B', 0.8),
        scored('B', 'A', 0.85),
      ],
    });

    expect(result.selected.map((selection) => ({
      oldNativeId: selection.candidate.candidate.old.nativeId,
      newNativeId: selection.candidate.candidate.new.nativeId,
      score: selection.candidate.score,
      proof: selection.proof,
    }))).toEqual([
      { oldNativeId: 'A', newNativeId: 'B', score: 0.8, proof: 'unique_maximum_weight_assignment' },
      { oldNativeId: 'B', newNativeId: 'A', score: 0.85, proof: 'unique_maximum_weight_assignment' },
    ]);
    expect(result.unresolved).toEqual([
      expect.objectContaining({
        candidate: expect.objectContaining({
          candidate: expect.objectContaining({
            old: { nativeId: 'A', kind: 'node' },
            new: { nativeId: 'A', kind: 'node' },
          }),
        }),
        reason: 'not_selected_by_higher_global_assignment',
      }),
    ]);
  });

  it('fails closed for a non-unique maximum-weight assignment', () => {
    const result = assignMaximumWeightCandidates({
      scored: [scored('A', 'A', 0.9), scored('A', 'B', 0.9), scored('C', 'C', 0.9)],
    });

    expect(result.selected.map((selection) => selection.candidate.candidate.old.nativeId)).toEqual(['C']);
    expect(result.unresolved).toEqual([
      expect.objectContaining({ reason: 'ambiguous_global_assignment_tie' }),
      expect.objectContaining({ reason: 'ambiguous_global_assignment_tie' }),
    ]);
  });

  it('fails closed for scores below the assignment floor or absent at runtime', () => {
    const result = assignMaximumWeightCandidates({
      scored: [scored('A', 'A', 0.64), scored('B', 'B', Number.NaN)],
    });

    expect(result.selected).toEqual([]);
    expect(result.unresolved).toEqual([
      expect.objectContaining({ reason: 'score_below_assignment_floor' }),
      expect.objectContaining({ reason: 'invalid_or_absent_score' }),
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
