import { describe, expect, it } from 'vitest';
import { assessStructuralTopology } from './structuralTopologyAssessment';
import { parseFlowchartSource } from './mermaidFlowchart';
import type { GlobalAssignmentSelection } from './globalAssignment';

describe('assessStructuralTopology', () => {
  it('compares mapped incoming and outgoing topology from Gate 4 evidence without confirming identity', () => {
    const old = parseFlowchartSource('flowchart TD\nGateway --> User --> Store');
    const newer = parseFlowchartSource('flowchart TD\nGateway2 --> Identity --> Store2');
    if (old.kind !== 'ok' || newer.kind !== 'ok') throw new Error('fixture must parse');

    const result = assessStructuralTopology({
      oldModel: old.model,
      newModel: newer.model,
      globalAssignmentSelections: [
        selection('Gateway', 'Gateway2'),
        selection('User', 'Identity'),
        selection('Store', 'Store2'),
      ],
    });

    expect(result.assessed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selection: expect.objectContaining({
          candidate: expect.objectContaining({
            candidate: expect.objectContaining({ old: { nativeId: 'User', kind: 'node' } }),
          }),
        }),
        incoming: { mappedOldNeighborNativeIds: ['Gateway2'], newNeighborNativeIds: ['Gateway2'], similarity: 1 },
        outgoing: { mappedOldNeighborNativeIds: ['Store2'], newNeighborNativeIds: ['Store2'], similarity: 1 },
        topologySimilarity: 1,
        evidence: 'provisional_global_assignment_mapped_neighbors',
        nextRequiredGate: 'split_merge_assessment',
      }),
    ]));
    expect(result.iteration).toEqual({
      status: 'deferred_requires_confirmed_neighbor_mappings',
      roundsRun: 0,
    });
    expect(result.unresolved).toEqual([]);
  });

  it('fails closed when a selected node has topology neighbors without Gate 4 mapping evidence', () => {
    const old = parseFlowchartSource('flowchart TD\nGateway --> User --> Store');
    const newer = parseFlowchartSource('flowchart TD\nGateway2 --> Identity --> Store2');
    if (old.kind !== 'ok' || newer.kind !== 'ok') throw new Error('fixture must parse');

    const result = assessStructuralTopology({
      oldModel: old.model,
      newModel: newer.model,
      globalAssignmentSelections: [selection('User', 'Identity')],
    });

    expect(result.assessed).toEqual([]);
    expect(result.unresolved).toEqual([
      expect.objectContaining({
        selection: expect.objectContaining({
          candidate: expect.objectContaining({
            candidate: expect.objectContaining({ old: { nativeId: 'User', kind: 'node' } }),
          }),
        }),
        reason: 'unmapped_neighbor_assignment_evidence',
      }),
    ]);
  });

  it('fails closed when Gate 4 evidence is not one-to-one at runtime', () => {
    const old = parseFlowchartSource('flowchart TD\nGateway --> User --> Store');
    const newer = parseFlowchartSource('flowchart TD\nGateway2 --> Identity --> Store2\nGateway2 --> Identity2');
    if (old.kind !== 'ok' || newer.kind !== 'ok') throw new Error('fixture must parse');

    const result = assessStructuralTopology({
      oldModel: old.model,
      newModel: newer.model,
      globalAssignmentSelections: [selection('User', 'Identity'), selection('User', 'Identity2')],
    });

    expect(result.assessed).toEqual([]);
    expect(result.unresolved).toHaveLength(2);
    expect(result.unresolved.map((item) => item.reason)).toEqual([
      'ambiguous_global_assignment_evidence',
      'ambiguous_global_assignment_evidence',
    ]);
  });

  it('fails closed when neither revision provides topology for a selected node', () => {
    const old = parseFlowchartSource('flowchart TD\nA[Isolated]');
    const newer = parseFlowchartSource('flowchart TD\nB[Isolated]');
    if (old.kind !== 'ok' || newer.kind !== 'ok') throw new Error('fixture must parse');

    const result = assessStructuralTopology({
      oldModel: old.model,
      newModel: newer.model,
      globalAssignmentSelections: [selection('A', 'B')],
    });

    expect(result.assessed).toEqual([]);
    expect(result.unresolved).toEqual([expect.objectContaining({ reason: 'missing_topology_evidence' })]);
  });
});

function selection(oldNativeId: string, newNativeId: string): GlobalAssignmentSelection {
  return {
    candidate: {
      candidate: {
        old: { kind: 'node', nativeId: oldNativeId },
        new: { kind: 'node', nativeId: newNativeId },
        sourceDiffRelocations: [],
        nextRequiredGate: 'fingerprint_scoring',
      },
      components: [],
      score: 0.9,
      availableWeight: 1,
      statementContextEvidence: 'unavailable',
      sourceDiffRelocationEvidence: 'absent',
      nextRequiredGate: 'global_assignment',
    },
    proof: 'unique_maximum_weight_assignment',
    componentMaximumScore: 0.9,
    componentCandidateCount: 1,
    nextRequiredGate: 'structural_topology_assessment',
  };
}
