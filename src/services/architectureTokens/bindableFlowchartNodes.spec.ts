import { describe, expect, it } from 'vitest';
import { listBindableFlowchartNodes } from './bindableFlowchartNodes';

describe('listBindableFlowchartNodes', () => {
  it('exposes only current active Flowchart nodes from source-current binding evidence', () => {
    const result = listBindableFlowchartNodes(availableState());

    expect(result).toEqual({
      kind: 'available',
      entries: [{
        diagramElementId: 'element-orders',
        displayName: 'Orders service',
      }],
    });
  });

  it('fails closed when saved binding evidence is stale or untrusted', () => {
    expect(listBindableFlowchartNodes({
      kind: 'stale',
      reason: 'source_hash_mismatch',
      sourceRevisionId: 'revision-current',
    })).toEqual({ kind: 'unavailable', reason: 'binding_evidence_unavailable' });

    expect(listBindableFlowchartNodes({ kind: 'untrusted', reason: 'invalid_state' })).toEqual({
      kind: 'unavailable',
      reason: 'binding_evidence_unavailable',
    });
  });

  it('fails closed rather than choosing between duplicate current mappings', () => {
    const state = availableState();
    state.state.revisionElements.push({
      ...state.state.revisionElements[0],
      primaryLocatorId: 'locator-orders-duplicate',
      locators: [{
        ...state.state.revisionElements[0].locators[0],
        locatorId: 'locator-orders-duplicate',
      }],
    });

    expect(listBindableFlowchartNodes(state)).toEqual({
      kind: 'unavailable',
      reason: 'ambiguous_current_elements',
    });
  });
});

function availableState() {
  return {
    kind: 'available' as const,
    sourceRevision: { sourceRevisionId: 'revision-current' },
    reconciliationHistory: [],
    state: {
      currentRevisionId: 'revision-current',
      elements: [
        {
          diagramElementId: 'element-orders',
          kind: 'node',
          createdInRevisionId: 'revision-current',
          lifecycleStatus: 'active',
        },
        {
          diagramElementId: 'element-retired',
          kind: 'node',
          createdInRevisionId: 'revision-current',
          lifecycleStatus: 'retired',
        },
      ],
      revisionElements: [{
        sourceRevisionId: 'revision-current',
        diagramElementId: 'element-orders',
        primaryLocatorId: 'locator-orders',
        locators: [{ locatorId: 'locator-orders' }],
        fingerprint: { normalizedLabel: 'Orders service' },
      }],
    },
  } as any;
}
