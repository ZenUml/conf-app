import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Mermaid from '@/components/Mermaid.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

const isDisplayModeMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isDisplayMode: isDisplayModeMock,
      initializeContext: vi.fn(() => Promise.resolve()),
    },
  },
}));

const loadMermaidMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/mermaid/loadMermaid', () => ({
  loadMermaid: loadMermaidMock,
}));

const viewerLoadFailedCalls = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'viewer_load_failed');

describe('Mermaid render-failure telemetry', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    isDisplayModeMock.mockReturnValue(true);
    window.__macroLoadStart = 0;
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'sequenceDiagram\nAlice->>Bob: hi',
    };
  });

  it('fires viewer_load_failed with failure_stage render_crash when mermaid.render() throws', async () => {
    loadMermaidMock.mockResolvedValue({
      render: vi.fn(() => Promise.reject(new Error('mermaid boom'))),
    });

    mount(Mermaid, { global: { plugins: [store] } });
    // mounted() is async: loadMermaid() -> mermaid.render() -> catch, all awaited.
    await vi.waitFor(() => {
      expect(viewerLoadFailedCalls()).toHaveLength(1);
    });

    const [, props] = viewerLoadFailedCalls()[0];
    expect(props).toMatchObject({
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'mermaid',
      failure_stage: 'render_crash',
      failure_reason: 'mermaid boom',
    });
  });

  it('does not fire viewer_load_failed on a clean render', async () => {
    loadMermaidMock.mockResolvedValue({
      render: vi.fn(() => Promise.resolve({ svg: '<svg>ok</svg>' })),
    });

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();
    await vi.waitFor(() => {
      expect(wrapper.vm.svg).toBeTruthy();
    });

    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });

  // The isDisplayMode=false (editor-preview) gate itself is unit-tested in
  // trackViewerRenderCrash.spec.ts — the shared Vuex store singleton here
  // memoizes the `isDisplayMode` getter on first read (it has no reactive
  // state dependency), so toggling the mock mid-file doesn't exercise a real
  // code path at this level.
});
