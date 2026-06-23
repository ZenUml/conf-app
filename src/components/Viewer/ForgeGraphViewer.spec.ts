import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ForgeGraphViewer from '@/components/Viewer/ForgeGraphViewer.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import globals from '@/model/globals';
import * as renderPerf from '@/utils/analytics/renderPerf';
import { getCachedSvg, putCachedSvg } from '@/utils/renderCache/renderCacheStore';

const trackMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/analytics/trackRenderTime', () => ({ trackRenderTime: trackMock.fn }));

const trackEventMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: trackEventMock.fn }));

// GenericViewer pulls in paywall/store wiring; stub to a slot passthrough.
vi.mock('@/components/Viewer/GenericViewer.vue', () => ({
  default: { name: 'GenericViewer', template: '<div class="gv"><slot /></div>' },
}));

describe('ForgeGraphViewer — render_ms instrumentation', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    renderPerf._resetForTesting();
    localStorage.clear(); // isolate the per-browser view cache between tests
    store.state.diagram = { ...NULL_DIAGRAM };
    (globals as any).apWrapper = { isDisplayMode: () => true };
    // DrawIO globals are injected by the loaded scripts at runtime — mock them.
    (window as any).mxUtils = {
      parseXml: vi.fn(() => ({ documentElement: { nodeName: 'mxGraphModel' } })),
    };
    (window as any).GraphViewer = vi.fn(function (this: any) {
      this.diagrams = [{}];
      this.currentPage = 0;
      // getSvg is what maybeCacheRenderedSvg exports to the view cache.
      this.graph = {
        getSvg: () => {
          const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          el.innerHTML = '<text>RENDERED_SVG</text>';
          return el;
        },
      };
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    delete (window as any).mxUtils;
    delete (window as any).GraphViewer;
  });

  it('times the GraphViewer construction as render_ms and emits macro_viewed', async () => {
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Graph,
      graphXml: '<mxGraphModel><root/></mxGraphModel>',
    };
    wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });
    await flushPromises();

    expect((window as any).GraphViewer).toHaveBeenCalledTimes(1);
    expect(trackMock.fn).toHaveBeenCalledWith('graph', true, 'live_render', 'none');
    // render_ms is now populated for graph (previously undefined).
    expect(typeof renderPerf.getTimings().render_ms).toBe('number');
  });

  it('injects the cached graphSvg and SKIPS GraphViewer construction (Lever D cached_svg)', async () => {
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Graph,
      graphXml: '<mxGraphModel><root/></mxGraphModel>',
      graphSvg: '<svg id="cached" xmlns="http://www.w3.org/2000/svg"><text>GCACHE</text></svg>',
    };
    wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });
    await flushPromises();

    expect((window as any).GraphViewer).not.toHaveBeenCalled(); // construction skipped
    expect(wrapper.html()).toContain('GCACHE');
    expect(trackMock.fn).toHaveBeenCalledWith('graph', true, 'cached_svg', 'cc_body');
  });

  it('back-catalog: caches the rendered SVG to localStorage after a live render', async () => {
    const xml = '<mxGraphModel><root/></mxGraphModel>';
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.Graph, graphXml: xml };
    wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });
    await flushPromises();

    expect((window as any).GraphViewer).toHaveBeenCalledTimes(1); // live render happened
    expect(getCachedSvg(xml)).toContain('RENDERED_SVG'); // warmed for next view
    expect(trackEventMock.fn).toHaveBeenCalledWith(
      'render_cache_write',
      expect.objectContaining({ macro_type: 'graph', render_cache_outcome: 'persisted' }),
    );
  });

  it('back-catalog: injects a localStorage-cached SVG and SKIPS GraphViewer (cache hit)', async () => {
    const xml = '<mxGraphModel><root/></mxGraphModel>';
    putCachedSvg(xml, '<svg id="ls" xmlns="http://www.w3.org/2000/svg"><text>LS_HIT</text></svg>');
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.Graph, graphXml: xml };
    wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });
    await flushPromises();

    expect((window as any).GraphViewer).not.toHaveBeenCalled(); // DrawIO render skipped
    expect(wrapper.html()).toContain('LS_HIT');
    expect(trackMock.fn).toHaveBeenCalledWith('graph', true, 'cached_svg', 'localstorage');
  });

  it('back-catalog: the cc_body SVG takes precedence over the localStorage cache', async () => {
    const xml = '<mxGraphModel><root/></mxGraphModel>';
    putCachedSvg(xml, '<svg id="ls"><text>LS_HIT</text></svg>');
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Graph,
      graphXml: xml,
      graphSvg: '<svg id="ccbody" xmlns="http://www.w3.org/2000/svg"><text>CCBODY</text></svg>',
    };
    wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });
    await flushPromises();

    expect(wrapper.html()).toContain('CCBODY');
    expect(wrapper.html()).not.toContain('LS_HIT');
    expect(trackMock.fn).toHaveBeenCalledWith('graph', true, 'cached_svg', 'cc_body');
  });

  it('does not render or emit when graphXml is empty (no DrawIO touched)', async () => {
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.Graph };
    wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });
    await flushPromises();

    expect((window as any).GraphViewer).not.toHaveBeenCalled();
    expect(trackMock.fn).not.toHaveBeenCalled();
    expect(renderPerf.getTimings().render_ms).toBeUndefined();
  });
});
