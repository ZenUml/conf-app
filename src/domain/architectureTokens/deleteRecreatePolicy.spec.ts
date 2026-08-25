import { describe, expect, it } from 'vitest';
import { classifyDeleteRecreateConfidence } from './deleteRecreatePolicy';
import type { FingerprintScoredCandidate } from './fingerprintScoring';

describe('classifyDeleteRecreateConfidence', () => {
  it('orphans a same-native-ID delete/recreate when label, container, topology, and revision-distance evidence all break', () => {
    const result = classifyDeleteRecreateConfidence({
      evidence: [{
        candidate: scored('A', 'A', 0.9, 'different', 'different'),
        topology: { topologySimilarity: 0 },
        revisionDistance: 'non_adjacent',
      }],
    });

    expect(result.outcomes).toEqual([expect.objectContaining({
      outcome: 'orphaned',
      confidenceBand: 'high',
      reasons: [
        'same_native_id_is_insufficient',
        'label_changed',
        'container_changed',
        'topology_changed',
        'non_adjacent_revision',
      ],
    })]);
  });

  it('fails closed when delete/recreate evidence is incomplete', () => {
    const result = classifyDeleteRecreateConfidence({
      evidence: [{
        candidate: scored('A', 'A', 0.9, 'different', 'exact'),
        topology: null,
        revisionDistance: 'unavailable',
      }],
    });

    expect(result.outcomes).toEqual([expect.objectContaining({
      outcome: 'unresolved_insufficient_evidence',
      reasons: expect.arrayContaining(['missing_topology_evidence', 'missing_revision_distance']),
    })]);
  });

  it('never auto-accepts a high-confidence same-ID candidate', () => {
    const result = classifyDeleteRecreateConfidence({
      evidence: [{
        candidate: scored('A', 'A', 0.95, 'exact', 'exact'),
        topology: { topologySimilarity: 1 },
        revisionDistance: 'adjacent',
      }],
    });

    expect(result.outcomes).toEqual([expect.objectContaining({
      outcome: 'requires_human_confirmation',
      confidenceBand: 'high',
      reasons: ['same_native_id_is_insufficient', 'confidence_not_identity_confirmation'],
    })]);
  });

  it('keeps a fully evidenced score below the suggestion band unresolved', () => {
    const result = classifyDeleteRecreateConfidence({
      evidence: [{
        candidate: scored('A', 'A', 0.64, 'exact', 'exact'),
        topology: { topologySimilarity: 1 },
        revisionDistance: 'adjacent',
      }],
    });

    expect(result.outcomes).toEqual([expect.objectContaining({
      outcome: 'unresolved_low_confidence',
      confidenceBand: 'low',
      reasons: ['score_below_suggestion_band'],
    })]);
  });
});

function scored(
  oldNativeId: string,
  newNativeId: string,
  score: number,
  labelEvidence: 'exact' | 'different',
  containerEvidence: 'exact' | 'different',
): FingerprintScoredCandidate {
  return {
    candidate: {
      old: { kind: 'node', nativeId: oldNativeId },
      new: { kind: 'node', nativeId: newNativeId },
      sourceDiffRelocations: [],
      nextRequiredGate: 'fingerprint_scoring',
    },
    components: [
      { signal: 'normalized_label', weight: 0.15, value: labelEvidence === 'exact' ? 1 : 0, weightedScore: 0, evidence: labelEvidence },
      { signal: 'container_path', weight: 0.05, value: containerEvidence === 'exact' ? 1 : 0, weightedScore: 0, evidence: containerEvidence },
    ],
    score,
    availableWeight: 1,
    statementContextEvidence: 'unavailable',
    sourceDiffRelocationEvidence: 'absent',
    nextRequiredGate: 'global_assignment',
  };
}
