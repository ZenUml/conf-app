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

const hasLayoutMock = vi.hoisted(() => vi.fn(() => true));
const awaitLayoutMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock('@/utils/renderGate/documentLayout', () => ({
  hasLayout: hasLayoutMock,
  awaitLayout: awaitLayoutMock,
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

// `mermaid.render()` measures a temp node with getBBox. In a document with no
// layout box (a `display: none` iframe) that measurement throws
// `svg element not in render tree` — reproduced against mermaid 11.12.2 in
// Chrome, see utils/renderGate/documentLayout.ts. 30 such events on
// 2026-08-10, 0.43% of Chrome mermaid renders, each one a permanently blank
// diagram because the catch left `svg` null with nothing to re-trigger it.
describe('Mermaid render retry when the document has no layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDisplayModeMock.mockReturnValue(true);
    hasLayoutMock.mockReturnValue(true);
    awaitLayoutMock.mockResolvedValue(true);
    window.__macroLoadStart = 0;
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'sequenceDiagram\nAlice->>Bob: hi',
    };
  });

  it('renders on the second attempt once the document gains a layout box', async () => {
    hasLayoutMock.mockReturnValue(false);
    awaitLayoutMock.mockResolvedValue(true);
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error('svg element not in render tree'))
      .mockResolvedValueOnce({ svg: '<svg>late</svg>' });
    loadMermaidMock.mockResolvedValue({ render });

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => {
      expect(wrapper.vm.svg).toBe('<svg>late</svg>');
    });

    expect(render).toHaveBeenCalledTimes(2);
    // The viewer recovered, so no failure reached the user and none is reported.
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });

  it('reports the failure when the retry also fails', async () => {
    hasLayoutMock.mockReturnValue(false);
    awaitLayoutMock.mockResolvedValue(false);
    const render = vi.fn(() => Promise.reject(new Error('svg element not in render tree')));
    loadMermaidMock.mockResolvedValue({ render });

    mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => {
      expect(viewerLoadFailedCalls()).toHaveLength(1);
    });

    expect(render).toHaveBeenCalledTimes(2);
    const [, props] = viewerLoadFailedCalls()[0];
    expect(props).toMatchObject({
      failure_stage: 'render_crash',
      failure_reason: 'svg element not in render tree',
    });
  });

  it('does not retry a failure raised while the document has layout', async () => {
    hasLayoutMock.mockReturnValue(true);
    const render = vi.fn(() => Promise.reject(new Error('Parse error on line 2')));
    loadMermaidMock.mockResolvedValue({ render });

    mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => {
      expect(viewerLoadFailedCalls()).toHaveLength(1);
    });

    // A syntax error is deterministic; retrying it only doubles the work.
    expect(render).toHaveBeenCalledTimes(1);
    expect(awaitLayoutMock).not.toHaveBeenCalled();
  });
});
