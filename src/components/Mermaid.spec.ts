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

const panZoomInstanceMock = vi.hoisted(() => ({
  destroy: vi.fn(),
  disableDblClickZoom: vi.fn(),
  getPan: vi.fn(() => ({ x: 0, y: 0 })),
  getZoom: vi.fn(() => 1),
  pan: vi.fn(),
  reset: vi.fn(),
  resize: vi.fn(),
  zoom: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
}));
const svgPanZoomMock = vi.hoisted(() => vi.fn(() => panZoomInstanceMock));
vi.mock('svg-pan-zoom', () => ({ default: svgPanZoomMock }));

const hammerManagerMock = vi.hoisted(() => ({
  destroy: vi.fn(),
  get: vi.fn(() => ({ set: vi.fn() })),
  on: vi.fn(),
}));
vi.mock('hammerjs', () => ({ default: vi.fn(() => hammerManagerMock) }));

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

describe('Mermaid fullscreen viewport controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasLayoutMock.mockReturnValue(true);
    window.__macroLoadStart = 0;
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'flowchart LR\n  A --> B',
    };
    loadMermaidMock.mockResolvedValue({
      render: vi.fn(() => Promise.resolve({
        svg: '<svg viewBox="0 0 400 200"><g><text>Diagram</text></g></svg>',
      })),
    });
  });

  afterEach(() => {
    delete window.forgeGlobal;
  });

  it('shows zoom controls in the fullscreen viewer', async () => {
    window.forgeGlobal = {
      forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } },
    } as any;

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(wrapper.find('[aria-label="Reset view"]').exists()).toBe(false);
      expect(wrapper.get('[aria-label="Zoom out"]').exists()).toBe(true);
      expect(wrapper.get('[aria-label="Zoom in"]').exists()).toBe(true);
      expect(svgPanZoomMock).toHaveBeenCalled();
    });

    const zoomOutCalls = panZoomInstanceMock.zoomOut.mock.calls.length;
    const zoomInCalls = panZoomInstanceMock.zoomIn.mock.calls.length;
    await wrapper.get('[aria-label="Zoom out"]').trigger('click');
    await wrapper.get('[aria-label="Zoom in"]').trigger('click');
    expect(panZoomInstanceMock.zoomOut).toHaveBeenCalledTimes(zoomOutCalls + 1);
    expect(panZoomInstanceMock.zoomIn).toHaveBeenCalledTimes(zoomInCalls + 1);
    expect(panZoomInstanceMock.reset).toHaveBeenCalled();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('mermaid_viewport_control_used', {
      feature_area: 'macro',
      surface: 'fullscreen',
      macro_type: 'mermaid',
      viewport_action: 'zoom_in',
    });
  });

  it('adds viewport controls to an inline diagram without fullscreen sizing', async () => {
    window.forgeGlobal = { forgeContext: { extension: {} } } as any;

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(wrapper.find('svg').exists()).toBe(true);
      expect(svgPanZoomMock).toHaveBeenCalled();
    });
    expect(wrapper.find('[aria-label="Zoom in"]').exists()).toBe(true);
    expect(wrapper.get('.mermaid-viewport').classes()).toContain('mermaid-viewport--interactive');
    expect(wrapper.get('.mermaid-viewport').classes()).not.toContain('mermaid-viewport--fullscreen');
  });

  it('preserves the natural Mermaid height for the inline pan/zoom viewport', async () => {
    window.forgeGlobal = { forgeContext: { extension: {} } } as any;
    const rectSpy = vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 200,
      top: 0,
      right: 400,
      bottom: 200,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const computedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      maxWidth: '400px',
    } as CSSStyleDeclaration);
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });

    await vi.waitFor(() => expect(svgPanZoomMock).toHaveBeenCalled());
    expect(wrapper.get('.mermaid-viewport').attributes('style')).toContain('height: 200px');

    clientWidthSpy.mockReturnValue(300);
    wrapper.vm.syncInlineViewportHeight();
    expect(wrapper.get('.mermaid-viewport').attributes('style')).toContain('height: 150px');

    rectSpy.mockRestore();
    computedStyleSpy.mockRestore();
    clientWidthSpy.mockRestore();
  });

  it('does not add viewport controls to the export-only render surface', async () => {
    window.forgeGlobal = {
      forgeContext: { extension: { modal: { macroMode: 'fullscreen', openExport: true } } },
    } as any;

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });

    await vi.waitFor(() => expect(wrapper.find('svg').exists()).toBe(true));
    expect(wrapper.find('[aria-label="Zoom in"]').exists()).toBe(false);
  });
});
