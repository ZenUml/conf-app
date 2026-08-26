import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserLocalArchitectureTokenDirectoryProvider,
} from '@/domain/architectureTokens/architectureTokenDirectory';
import { readArchitectureTokenBindingState } from '@/domain/architectureTokens/architectureTokenBindingState';
import { DiagramType, type Diagram, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import store from '@/model/store2';
import { prepareMermaidStaticIngestion } from '@/services/architectureTokens/prepareMermaidStaticIngestion';
import { readMermaidArchitectureTokenBinding } from '@/services/architectureTokens/readMermaidArchitectureTokenBinding';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import ArchitectureTokenBindingActions from './ArchitectureTokenBindingActions.vue';
import { architectureTokenDirectoryProviderKey } from './architectureTokenDirectoryProvider';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

const SOURCE = 'flowchart TD\n  A[Orders service] --> B[Database]';

describe('ArchitectureTokenBindingActions', () => {
  enableAutoUnmount(afterEach);

  beforeEach(async () => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    store.state.diagram = await capturedDiagram();
  });

  it('remains read-only when no browser-local directory provider was explicitly injected', async () => {
    const wrapper = mount(ArchitectureTokenBindingActions, { global: { plugins: [store] } });
    await flushPromises();

    expect(wrapper.find('[data-testid="architecture-token-binding-actions"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Binding actions are not configured');
    expect(wrapper.findAll('select, button')).toHaveLength(0);
  });

  it('fails closed when a provider exists but saved evidence is stale', async () => {
    store.state.diagram.architectureTokenBindingReadState = {
      kind: 'stale',
      reason: 'source_hash_mismatch',
      sourceRevisionId: 'revision-old',
    };
    const provider = createBrowserLocalArchitectureTokenDirectoryProvider([{
      logicalTokenId: 'logical-orders',
      displayName: 'Orders service',
    }]);
    const wrapper = mount(ArchitectureTokenBindingActions, {
      global: {
        plugins: [store],
        provide: { [architectureTokenDirectoryProviderKey as symbol]: provider },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('unavailable until saved evidence matches this diagram');
    expect(wrapper.findAll('select, button')).toHaveLength(0);
  });

  it('uses an injected local provider to select a current node, bind, and unbind without exposing identifiers to analytics', async () => {
    const provider = createBrowserLocalArchitectureTokenDirectoryProvider([{
      logicalTokenId: 'logical-orders',
      tokenId: 'enterprise-orders',
      displayName: 'Orders service',
    }]);
    const wrapper = mount(ArchitectureTokenBindingActions, {
      global: {
        plugins: [store],
        provide: { [architectureTokenDirectoryProviderKey as symbol]: provider },
      },
    });
    await flushPromises();

    const nodeSelect = wrapper.find('[data-testid="architecture-token-node-select"]');
    const tokenSelect = wrapper.find('[data-testid="architecture-token-select"]');
    expect(nodeSelect.findAll('option')).toHaveLength(3);
    expect(tokenSelect.text()).toContain('Orders service');

    await nodeSelect.setValue(nodeSelect.findAll('option')[1].attributes('value'));
    await tokenSelect.setValue('logical-orders');
    await wrapper.find('[data-testid="architecture-token-bind"]').trigger('click');
    await flushPromises();

    const decoded = readArchitectureTokenBindingState(store.state.diagram.metadata);
    expect(decoded).toMatchObject({ kind: 'ok' });
    if (decoded.kind !== 'ok' || !decoded.value) throw new Error('binding state must be persisted in diagram metadata');
    expect(decoded.value.bindings).toMatchObject([{ logicalTokenId: 'logical-orders' }]);
    expect(JSON.stringify(store.state.diagram.metadata)).not.toContain('Orders service');
    expect(wrapper.text()).toContain('Binding added. Save the diagram to persist it.');
    expect(wrapper.find('[data-testid="architecture-token-unbind"]').exists()).toBe(true);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('architecture_token_bind_succeeded', expect.objectContaining({
      feature_area: 'architecture_tokens',
      result: 'bound',
    }));
    expect(JSON.stringify(vi.mocked(trackAnalyticsEvent).mock.calls)).not.toContain('logical-orders');
    expect(JSON.stringify(vi.mocked(trackAnalyticsEvent).mock.calls)).not.toContain('Orders service');

    await wrapper.find('[data-testid="architecture-token-unbind"]').trigger('click');
    await flushPromises();
    expect(readState().bindings).toEqual([]);
    expect(wrapper.text()).toContain('Binding removed. Save the diagram to persist it.');
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('architecture_token_unbind_succeeded', expect.objectContaining({
      feature_area: 'architecture_tokens',
      result: 'unbound',
    }));
  });
});

function readState() {
  const decoded = readArchitectureTokenBindingState(store.state.diagram.metadata);
  if (decoded.kind !== 'ok' || !decoded.value) throw new Error('binding state must be available');
  return decoded.value;
}

async function capturedDiagram(): Promise<Diagram> {
  const diagram = {
    ...NULL_DIAGRAM,
    diagramType: DiagramType.Mermaid,
    mermaidCode: SOURCE,
    metadata: {},
  } as Diagram;
  await prepareMermaidStaticIngestion(diagram, testDependencies());
  diagram.architectureTokenBindingReadState = await readMermaidArchitectureTokenBinding(diagram);
  diagram.architectureTokenBindingLoadedSource = SOURCE;
  return diagram;
}

function testDependencies() {
  return {
    validate: async () => ({
      kind: 'ok' as const,
      model: {
        kind: 'flowchart' as const,
        direction: 'TD' as const,
        edges: [],
        subgraphs: [],
        nodes: ['A', 'B'].map((nativeId) => ({
          kind: 'node' as const,
          nativeId,
          label: nativeId === 'A' ? 'Orders service' : 'Database',
          shape: 'square',
          containerPath: [],
          primaryOccurrence: occurrence(nativeId),
          occurrences: [occurrence(nativeId)],
          incidentNativeIds: [],
          statementContexts: [nativeId],
        })),
      },
      locatorEvidence: { kind: 'jison_preferred' as const, adapterVersion: 'test', occurrenceCount: 2 },
    }),
    createId: (() => {
      let count = 0;
      return () => `id-${++count}`;
    })(),
    now: () => '2026-08-26T00:00:00.000Z',
  };
}

function occurrence(nativeId: string) {
  return {
    role: 'edge_endpoint' as const,
    span: { startByte: nativeId === 'A' ? 13 : 36, endByte: nativeId === 'A' ? 14 : 37 },
    statementSpan: { startByte: 13, endByte: 37 },
  };
}
