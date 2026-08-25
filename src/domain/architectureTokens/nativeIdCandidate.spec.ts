import { describe, expect, it } from 'vitest';
import { assessExactNativeIdNodeCandidates } from './nativeIdCandidate';
import { parseFlowchartSource } from './mermaidFlowchart';
import { prepareSourceDiffRelocation } from './sourceDiffRelocation';

describe('assessExactNativeIdNodeCandidates', () => {
  it('offers same-ID Flowchart nodes only as candidates and carries source-diff evidence separately', () => {
    const oldSource = 'flowchart TD\nA[Orders API] --> B';
    const newSource = 'flowchart TD\nA[Payments API] --> B';
    const old = parseFlowchartSource(oldSource);
    const newer = parseFlowchartSource(newSource);
    if (old.kind !== 'ok' || newer.kind !== 'ok') throw new Error('fixture must parse');

    const relocation = prepareSourceDiffRelocation({
      oldSource,
      newSource,
      oldLocators: old.model.nodes.flatMap((node) => node.occurrences.map((occurrence, index) => ({
        locatorId: `${node.nativeId}:${index}`,
        span: occurrence.span,
      }))),
    });
    const result = assessExactNativeIdNodeCandidates({
      oldNodes: old.model.nodes,
      newNodes: newer.model.nodes,
      sourceDiffRelocations: relocation.relocations,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        old: { kind: 'node', nativeId: 'A' },
        new: { kind: 'node', nativeId: 'A' },
        sourceDiffRelocations: [],
        nextRequiredGate: 'fingerprint_scoring',
      }),
      expect.objectContaining({
        old: { kind: 'node', nativeId: 'B' },
        new: { kind: 'node', nativeId: 'B' },
        sourceDiffRelocations: [expect.objectContaining({ provenance: 'source_diff_unchanged', confidence: 1 })],
        nextRequiredGate: 'fingerprint_scoring',
      }),
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it('fails closed when a node has no exact native-ID candidate', () => {
    const old = parseFlowchartSource('flowchart TD\nOrders[Orders API]');
    const newer = parseFlowchartSource('flowchart TD\nPayments[Orders API]');
    if (old.kind !== 'ok' || newer.kind !== 'ok') throw new Error('fixture must parse');

    const result = assessExactNativeIdNodeCandidates({
      oldNodes: old.model.nodes,
      newNodes: newer.model.nodes,
      sourceDiffRelocations: [],
    });

    expect(result.candidates).toEqual([]);
    expect(result.unmatched).toEqual([{
      old: { kind: 'node', nativeId: 'Orders' },
      reason: 'no_exact_native_id_candidate',
    }]);
  });

  it('fails closed rather than selecting between duplicate native-ID facts', () => {
    const old = parseFlowchartSource('flowchart TD\nA[Orders API]');
    const newer = parseFlowchartSource('flowchart TD\nA[Orders API]');
    if (old.kind !== 'ok' || newer.kind !== 'ok') throw new Error('fixture must parse');

    const result = assessExactNativeIdNodeCandidates({
      oldNodes: old.model.nodes,
      newNodes: [newer.model.nodes[0], newer.model.nodes[0]],
      sourceDiffRelocations: [],
    });

    expect(result.candidates).toEqual([]);
    expect(result.unmatched).toEqual([{
      old: { kind: 'node', nativeId: 'A' },
      reason: 'duplicate_native_id_candidate',
    }]);
  });
});
