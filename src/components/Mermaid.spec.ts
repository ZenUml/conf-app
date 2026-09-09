import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Mermaid from '@/components/Mermaid.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import EventBus from '@/EventBus';

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

describe('Mermaid pasted-whitespace normalisation', () => {
  const NBSP = '\u00A0';

  beforeEach(() => {
    vi.clearAllMocks();
    isDisplayModeMock.mockReturnValue(true);
    hasLayoutMock.mockReturnValue(true);
    window.__macroLoadStart = 0;
  });

  // Rich-text paste turns indentation into U+00A0, which mermaid's Langium
  // grammars reject outright. The stored body keeps the character, so the fix
  // has to apply at render time or the diagram stays blank forever.
  it('renders stored content whose indentation is NBSP', async () => {
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: `pie title Pets\n${NBSP}${NBSP}"Dogs" : 386`,
    };
    const render = vi.fn((_id: string, _code: string) => Promise.resolve({ svg: '<svg />' }));
    loadMermaidMock.mockResolvedValue({ render });

    mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => {
      expect(render.mock.calls.length).toBeGreaterThan(0);
    });

    // Every call, not just the first: the watcher re-renders on its own and
    // each pass must see normalised source.
    for (const [, code] of render.mock.calls) {
      expect(code).toBe('pie title Pets\n  "Dogs" : 386');
    }
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });

  it('passes clean content through untouched', async () => {
    const clean = 'sequenceDiagram\n  Alice->>Bob: hi';
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: clean,
    };
    const render = vi.fn((_id: string, _code: string) => Promise.resolve({ svg: '<svg />' }));
    loadMermaidMock.mockResolvedValue({ render });

    mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => {
      expect(render.mock.calls.length).toBeGreaterThan(0);
    });

    for (const [, code] of render.mock.calls) {
      expect(code).toBe(clean);
    }
  });
});

describe('Mermaid viewer zoom', () => {
  // A diagram wide enough that a real browser would shrink it. jsdom has no
  // layout, so the component measures a fit scale of 1 (see measureFitScale's
  // comment) and every level below reads against 100% — which is exactly the
  // arithmetic under test here. The browser-measured half, where the fit scale
  // is genuinely below 1, is covered by the MermaidSizing stories.
  const SVG = '<svg id="mermaid-1" style="max-width: 1766px;" viewBox="0 0 1766 900" width="100%"></svg>';

  const mountViewer = () => mount(Mermaid, { global: { plugins: [store] } });

  const wheelEvent = (init: WheelEventInit) =>
    new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });

  const zoomEvents = () =>
    vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'viewer_zoom_changed');

  async function mountRendered() {
    const wrapper = mountViewer();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="mermaid-zoom-controls"]').exists()).toBe(true);
    });
    return wrapper;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    isDisplayModeMock.mockReturnValue(true);
    hasLayoutMock.mockReturnValue(true);
    window.__macroLoadStart = 0;
    (window as any).forgeGlobal = { forgeContext: { moduleKey: 'zenuml-sequence-macro' } };
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'flowchart TD\n A --> B',
    };
    loadMermaidMock.mockResolvedValue({
      render: vi.fn(() => Promise.resolve({ svg: SVG })),
    });
  });

  afterEach(() => {
    delete (window as any).forgeGlobal;
  });

  it('offers the control in the viewer', async () => {
    const wrapper = await mountRendered();

    expect(wrapper.find('[data-testid="mermaid-zoom-in"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="mermaid-zoom-out"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="mermaid-zoom-reset"]').text()).toBe('100%');
  });

  // The editor has its own preview pane and the byline dialog is a thumbnail;
  // neither is a reading surface, and the byline one would also mislabel its
  // events as surface:'viewer'.
  it('leaves the editor render untouched', async () => {
    isDisplayModeMock.mockReturnValue(false);
    const wrapper = mountViewer();
    await vi.waitFor(() => {
      expect(wrapper.html()).toContain('mermaid-1');
    });

    expect(wrapper.find('[data-testid="mermaid-zoom-controls"]').exists()).toBe(false);
  });

  it('leaves the byline preview untouched', async () => {
    (window as any).forgeGlobal = { forgeContext: { moduleKey: 'zenuml-byline-diagrams' } };
    const wrapper = mountViewer();
    await vi.waitFor(() => {
      expect(wrapper.html()).toContain('mermaid-1');
    });

    expect(wrapper.find('[data-testid="mermaid-zoom-controls"]').exists()).toBe(false);
  });

  // The whole point of the fit-level identity transform: a reader who never
  // touches the control sees the DOM that shipped before this feature.
  it('applies no transform until the reader zooms', async () => {
    const wrapper = await mountRendered();

    const canvas = wrapper.find('.mermaid-zoom-canvas');
    expect(canvas.attributes('style')).toBeUndefined();
    expect(wrapper.find('.mermaid-zoom-viewport').classes()).not.toContain('mermaid-zoom-viewport--zoomed');
  });

  it('zooms in one ladder step per click and reports it', async () => {
    const wrapper = await mountRendered();

    await wrapper.find('[data-testid="mermaid-zoom-in"]').trigger('click');

    expect(wrapper.find('[data-testid="mermaid-zoom-reset"]').text()).toBe('125%');
    expect(wrapper.find('.mermaid-zoom-canvas').attributes('style')).toContain('scale(1.25)');
    expect(wrapper.find('.mermaid-zoom-viewport').classes()).toContain('mermaid-zoom-viewport--zoomed');

    expect(zoomEvents()).toHaveLength(1);
    expect(zoomEvents()[0][1]).toMatchObject({
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'mermaid',
      zoom_action: 'in',
      zoom_input: 'button',
      zoom_level: 1.25,
      zoom_fit_scale: 1,
    });
  });

  it('returns to the fit level, transform and all, on reset', async () => {
    const wrapper = await mountRendered();
    await wrapper.find('[data-testid="mermaid-zoom-in"]').trigger('click');

    await wrapper.find('[data-testid="mermaid-zoom-reset"]').trigger('click');

    expect(wrapper.find('[data-testid="mermaid-zoom-reset"]').text()).toBe('100%');
    expect(wrapper.find('.mermaid-zoom-canvas').attributes('style')).toBeUndefined();
    expect(zoomEvents()[1][1]).toMatchObject({ zoom_action: 'reset', zoom_level: 1 });
  });

  it('stops at the top of the ladder rather than reporting clicks that change nothing', async () => {
    const wrapper = await mountRendered();
    const zoomIn = wrapper.find('[data-testid="mermaid-zoom-in"]');

    for (let i = 0; i < 12; i++) await zoomIn.trigger('click');

    expect(wrapper.find('[data-testid="mermaid-zoom-reset"]').text()).toBe('400%');
    // 1 -> 1.25 -> ... -> 4 is seven steps; the clicks past the ceiling move
    // nothing and must not be counted as zooms.
    expect(zoomEvents()).toHaveLength(7);
    expect(zoomIn.attributes('disabled')).toBeDefined();
  });

  // An unmodified wheel belongs to the scrolling page (inline) or the
  // scrolling modal (fullscreen) — never to the diagram.
  it('ignores a plain wheel and zooms on ctrl+wheel', async () => {
    const wrapper = await mountRendered();
    const viewport = wrapper.find('.mermaid-zoom-viewport');

    // Dispatched natively: vue-test-utils' trigger() cannot set ctrlKey, and
    // the modifier is the whole point of this test.
    const plain = wheelEvent({ deltaY: -100 });
    viewport.element.dispatchEvent(plain);
    await wrapper.vm.$nextTick();
    expect(plain.defaultPrevented).toBe(false);
    expect(wrapper.find('[data-testid="mermaid-zoom-reset"]').text()).toBe('100%');

    const pinch = wheelEvent({ deltaY: -100, ctrlKey: true });
    viewport.element.dispatchEvent(pinch);
    await wrapper.vm.$nextTick();
    expect(pinch.defaultPrevented).toBe(true);
    expect(wrapper.find('[data-testid="mermaid-zoom-reset"]').text()).not.toBe('100%');
  });

  it('coalesces a wheel gesture into one event', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountRendered();
      const viewport = wrapper.find('.mermaid-zoom-viewport');

      for (let i = 0; i < 6; i++) {
        viewport.element.dispatchEvent(wheelEvent({ deltaY: -40, ctrlKey: true }));
      }
      await wrapper.vm.$nextTick();
      expect(zoomEvents()).toHaveLength(0);

      vi.advanceTimersByTime(500);
      expect(zoomEvents()).toHaveLength(1);
      expect(zoomEvents()[0][1]).toMatchObject({ zoom_input: 'wheel', zoom_action: 'in' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('zooms and resets from the keyboard', async () => {
    const wrapper = await mountRendered();
    const zoom = wrapper.find('.mermaid-zoom');

    await zoom.trigger('keydown', { key: '+' });
    expect(wrapper.find('[data-testid="mermaid-zoom-reset"]').text()).toBe('125%');

    await zoom.trigger('keydown', { key: '0' });
    expect(wrapper.find('[data-testid="mermaid-zoom-reset"]').text()).toBe('100%');
    expect(zoomEvents().map(([, props]: any) => props.zoom_input)).toEqual(['keyboard', 'keyboard']);
  });

  // Export rasterises the capture node as it stands: a zoomed diagram would
  // otherwise export as the fragment the reader was looking at, with the
  // control pill baked into the picture.
  it('drops back to fit and hides its chrome while a capture runs', async () => {
    const wrapper = await mountRendered();
    await wrapper.find('[data-testid="mermaid-zoom-in"]').trigger('click');

    EventBus.$emit('diagramCaptureStart');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.mermaid-zoom-canvas').attributes('style')).toBeUndefined();
    expect(wrapper.find('[data-testid="mermaid-zoom-controls"]').exists()).toBe(false);
    // The reset was ours, not the reader's — it is not a zoom action.
    expect(zoomEvents()).toHaveLength(1);

    EventBus.$emit('diagramCaptureEnd');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="mermaid-zoom-controls"]').exists()).toBe(true);
  });

  it('starts the next diagram at its own fit level', async () => {
    const wrapper = await mountRendered();
    await wrapper.find('[data-testid="mermaid-zoom-in"]').trigger('click');
    expect(wrapper.find('[data-testid="mermaid-zoom-reset"]').text()).toBe('125%');

    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'flowchart TD\n C --> D',
    };
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="mermaid-zoom-reset"]').text()).toBe('100%');
    });
    expect(wrapper.find('.mermaid-zoom-canvas').attributes('style')).toBeUndefined();
  });
});
