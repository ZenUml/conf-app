import { describe, expect, it } from 'vitest';
import { fingerprintFlowchartNode, reconcileFlowchartNodes } from './reconcileFlowchartNodes';
import type { CanonicalNode } from './mermaidFlowchart';

const node = (nativeId: string, overrides: Partial<CanonicalNode> = {}): CanonicalNode => ({
  kind: 'node',
  nativeId,
  label: 'Orders API',
  shape: 'square',
  containerPath: ['Platform'],
  occurrences: [],
  incidentNativeIds: ['Gateway'],
  statementContexts: ['A --> B'],
  ...overrides,
});

describe('reconcileFlowchartNodes', () => {
  it('automatically retains an element only when an exact fingerprint is independently source-diff relocated', () => {
    const old = node('orders');
    const current = node('orders');

    const result = reconcileFlowchartNodes({
      oldElements: [{ diagramElementId: 'element-orders', fingerprint: fingerprintFlowchartNode(old) }],
      newNodes: [current],
      relocatedPairs: [{ diagramElementId: 'element-orders', newNativeId: 'orders' }],
    });

    expect(result.decisions).toEqual([expect.objectContaining({
      diagramElementId: 'element-orders',
      status: 'confirmed_automatic',
      newNativeId: 'orders',
      reasons: ['source_diff_relocated', 'fingerprint_exact'],
    })]);
  });

  it('never auto-confirms a same-ID delete/recreate candidate without source-diff relocation', () => {
    const result = reconcileFlowchartNodes({
      oldElements: [{ diagramElementId: 'element-orders', fingerprint: fingerprintFlowchartNode(node('orders')) }],
      newNodes: [node('orders', { label: 'Recreated Orders API', incidentNativeIds: [] })],
      relocatedPairs: [],
    });

    expect(result.decisions).toEqual([expect.objectContaining({
      diagramElementId: 'element-orders',
      status: 'needs_confirmation',
      newNativeId: 'orders',
      reasons: ['native_id_is_insufficient'],
    })]);
  });

  it('fails closed for a split into multiple equally plausible nodes', () => {
    const result = reconcileFlowchartNodes({
      oldElements: [{ diagramElementId: 'element-orders', fingerprint: fingerprintFlowchartNode(node('orders')) }],
      newNodes: [node('orders-read'), node('orders-write')],
      relocatedPairs: [],
    });

    expect(result.decisions).toEqual([expect.objectContaining({
      diagramElementId: 'element-orders',
      status: 'ambiguous',
      reasons: ['multiple_plausible_candidates'],
      candidateNativeIds: ['orders-read', 'orders-write'],
    })]);
  });

  it('fails closed for a merge when two logical elements have one plausible replacement', () => {
    const result = reconcileFlowchartNodes({
      oldElements: [
        { diagramElementId: 'element-orders-read', fingerprint: fingerprintFlowchartNode(node('orders-read')) },
        { diagramElementId: 'element-orders-write', fingerprint: fingerprintFlowchartNode(node('orders-write')) },
      ],
      newNodes: [node('orders')],
      relocatedPairs: [],
    });

    expect(result.decisions).toEqual([
      expect.objectContaining({ status: 'ambiguous', reasons: ['one_to_one_conflict'] }),
      expect.objectContaining({ status: 'ambiguous', reasons: ['one_to_one_conflict'] }),
    ]);
  });
});
