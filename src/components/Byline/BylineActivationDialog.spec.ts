import { flushPromises, shallowMount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BylineActivationDialog from './BylineActivationDialog.vue';

const h = vi.hoisted(() => ({
  fetchPreparedDiagram: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock('@/services/ActivationPrepared', () => ({
  fetchPreparedDiagram: h.fetchPreparedDiagram,
  preparedToDiagram: (payload: any) => ({
    diagramType: payload.diagramType,
    mermaidCode: payload.diagramSource,
  }),
  preparedAgeDays: () => 0,
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      currentPageId: 'page-1',
    },
  },
}));

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: { cloudId: 'cloud-1', extension: { content: { id: 'page-1' } } } },
  openModal: vi.fn(),
}));

vi.mock('@forge/bridge', () => ({ view: { close: vi.fn() } }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: h.trackAnalyticsEvent,
}));

describe('BylineActivationDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    h.fetchPreparedDiagram.mockResolvedValue({
      diagramType: 'mermaid',
      diagramSource: 'flowchart TD\nA --> B',
      title: 'Prepared by AI',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the AI-prepared preview', async () => {
    const wrapper = shallowMount(BylineActivationDialog, {
      global: { stubs: { DiagramPortal: true } },
    });

    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_800);
    await flushPromises();

    expect(wrapper.text()).toContain('This page, as a diagram');
    expect(wrapper.text()).not.toContain('Diagrams on this page');
    wrapper.unmount();
  });
});
