import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ForgeGraphViewer from '@/components/Viewer/ForgeGraphViewer.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isDisplayMode: vi.fn(() => true),
    },
  },
}));

vi.mock('@/components/Viewer/GenericViewer.vue', () => ({
  default: {
    name: 'GenericViewer',
    template: '<div class="generic-viewer"><slot /></div>',
  },
}));

const macroViewedCalls = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'macro_viewed');
const viewerLoadFailedCalls = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'viewer_load_failed');

/**
 * VTU's `trigger` cannot set `ctrlKey` — it is getter-only on MouseEvent — so
 * the modifier cases dispatch a real WheelEvent. Returns it, so a test can also
 * assert whether the page's scroll was taken away.
 */
function wheel(element: Element, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
  element.dispatchEvent(event);
  return event;
}

const VALID_XML = '<mxGraphModel><root></root></mxGraphModel>';

describe('ForgeGraphViewer render-failure telemetry', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    window.__macroLoadStart = 0;
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Graph,
      graphXml: VALID_XML,
    };
    // @ts-ignore — DrawIO globals, loaded at runtime by loadDrawioViewer.ts.
    window.mxUtils = { parseXml: vi.fn(() => ({ documentElement: {} })) };
  });

  it('fires viewer_load_failed AND does not fire macro_viewed when GraphViewer construction throws — audit §4: neither used to fire', async () => {
    // @ts-ignore
    window.GraphViewer = vi.fn(() => {
      throw new Error('drawio init boom');
    });

    mount(ForgeGraphViewer, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(viewerLoadFailedCalls()).toHaveLength(1);
    });
    const [, props] = viewerLoadFailedCalls()[0];
    expect(props).toMatchObject({
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'graph',
      failure_stage: 'render_crash',
      failure_reason: 'drawio init boom',
    });
    // The pre-fix bug: trackRenderTime sits inside the same try block a
    // crash escapes, so macro_viewed never fires on this path either.
    expect(macroViewedCalls()).toHaveLength(0);
  });

  it('fires viewer_load_failed when mxUtils.parseXml throws (malformed graphXml)', async () => {
    // @ts-ignore
    window.mxUtils = {
      parseXml: vi.fn(() => {
        throw new Error('bad xml');
      }),
    };
    // @ts-ignore
    window.GraphViewer = vi.fn(() => ({ diagrams: [] }));

    mount(ForgeGraphViewer, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(viewerLoadFailedCalls()).toHaveLength(1);
    });
    expect(viewerLoadFailedCalls()[0][1]).toMatchObject({
      macro_type: 'graph',
      failure_stage: 'render_crash',
      failure_reason: 'bad xml',
    });
  });

  it('fires macro_viewed and no failure on a clean render', async () => {
    // @ts-ignore
    window.GraphViewer = vi.fn(() => ({ diagrams: [{}], currentPage: 0 }));

    mount(ForgeGraphViewer, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(macroViewedCalls()).toHaveLength(1);
    });
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });

  it('publishes the rendered graph box for export framing', async () => {
    // GraphViewer's canvas intentionally remains 100% wide in fullscreen;
    // captureCrop uses these dimensions to retain the graph's own bounds.
    // @ts-ignore
    window.GraphViewer = vi.fn(() => ({
      graph: {
        getGraphBounds: () => ({ width: 200, height: 120 }),
        // graphBounds are already view-scaled CSS pixels in mxGraphView.
        view: { scale: 0.5 },
        border: 10,
      },
      diagrams: [{}],
      currentPage: 0,
    }));

    const wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });
    await vi.waitFor(() => expect(wrapper.find('.graph-viewer-canvas').attributes()).toMatchObject({
      'data-diagram-capture-root': '',
      'data-capture-box-width': '220',
      'data-capture-box-height': '140',
    }));
  });

  describe('pan and zoom controls', () => {
    const graphStub = () => ({
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      setPanning: vi.fn(),
      panningHandler: { useLeftButtonForPanning: false, ignoreCell: false },
      getGraphBounds: () => ({ width: 200, height: 120 }),
      view: { scale: 1 },
      border: 10,
    });

    afterEach(() => {
      delete (window as { forgeGlobal?: unknown }).forgeGlobal;
    });

    it('drives mxGraph\'s own zoom from the shared toolbar', async () => {
      const graph = graphStub();
      // @ts-ignore
      window.GraphViewer = vi.fn(() => ({ graph, diagrams: [{}], currentPage: 0 }));

      const wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });
      await vi.waitFor(() => {
        expect(wrapper.find('[aria-label="Zoom in"]').exists()).toBe(true);
      });
      expect(wrapper.get('[role="toolbar"]').attributes('aria-label')).toBe('Graph zoom controls');

      await wrapper.get('[aria-label="Zoom in"]').trigger('click');
      await wrapper.get('[aria-label="Zoom out"]').trigger('click');

      // Not svg-pan-zoom: GraphViewer owns its layout, so zooming goes through
      // the same mxGraph calls DrawIO's own toolbar makes.
      expect(graph.zoomIn).toHaveBeenCalledTimes(1);
      expect(graph.zoomOut).toHaveBeenCalledTimes(1);
      expect(trackAnalyticsEvent).toHaveBeenCalledWith('viewport_control_used', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: 'graph',
        viewport_action: 'zoom_in',
        viewport_input: 'toolbar',
      });
    });

    it('turns on drag-to-pan once the graph is rendered', async () => {
      const graph = graphStub();
      // @ts-ignore
      window.GraphViewer = vi.fn(() => ({ graph, diagrams: [{}], currentPage: 0 }));

      mount(ForgeGraphViewer, { global: { plugins: [store] } });

      await vi.waitFor(() => {
        expect(graph.setPanning).toHaveBeenCalledWith(true);
      });
      expect(graph.panningHandler.useLeftButtonForPanning).toBe(true);
    });

    it('zooms on Ctrl/Cmd + wheel, the way the other three viewports do', async () => {
      const graph = graphStub();
      // @ts-expect-error window.GraphViewer is injected by the drawio bundle
      window.GraphViewer = vi.fn(() => ({ graph, diagrams: [{}], currentPage: 0 }));

      const wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });
      await vi.waitFor(() => expect(graph.setPanning).toHaveBeenCalled());
      const canvas = wrapper.get('.graph-viewer-canvas');

      wheel(canvas.element, { deltaY: -100, ctrlKey: true });
      expect(graph.zoomIn).toHaveBeenCalledTimes(1);

      wheel(canvas.element, { deltaY: 100, ctrlKey: true });
      expect(graph.zoomOut).toHaveBeenCalledTimes(1);

      // macOS holds Cmd, and a trackpad pinch arrives as a ctrlKey wheel.
      wheel(canvas.element, { deltaY: -100, metaKey: true });
      expect(graph.zoomIn).toHaveBeenCalledTimes(2);
    });

    it('leaves a plain wheel to the page rather than zooming', async () => {
      const graph = graphStub();
      // @ts-expect-error window.GraphViewer is injected by the drawio bundle
      window.GraphViewer = vi.fn(() => ({ graph, diagrams: [{}], currentPage: 0 }));

      const wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });
      await vi.waitFor(() => expect(graph.setPanning).toHaveBeenCalled());

      // The page viewer's Forge iframe is sized to the diagram, so a tall graph
      // covers the reading area: taking the wheel there traps the reader.
      const event = wheel(wrapper.get('.graph-viewer-canvas').element, { deltaY: -400 });

      expect(graph.zoomIn).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('spends a trackpad\'s small deltas one zoom step at a time', async () => {
      const graph = graphStub();
      // @ts-expect-error window.GraphViewer is injected by the drawio bundle
      window.GraphViewer = vi.fn(() => ({ graph, diagrams: [{}], currentPage: 0 }));

      const wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });
      await vi.waitFor(() => expect(graph.setPanning).toHaveBeenCalled());
      const canvas = wrapper.get('.graph-viewer-canvas');

      // A two-finger swipe is a stream of these; one step per notch-worth, not
      // one per event, or the diagram rockets through the zoom range.
      for (let i = 0; i < 9; i += 1) {
        wheel(canvas.element, { deltaY: -10, ctrlKey: true });
      }
      expect(graph.zoomIn).not.toHaveBeenCalled();

      wheel(canvas.element, { deltaY: -10, ctrlKey: true });
      expect(graph.zoomIn).toHaveBeenCalledTimes(1);
    });

    it('does not stack wheel listeners when the diagram re-renders', async () => {
      const graph = graphStub();
      // @ts-expect-error window.GraphViewer is injected by the drawio bundle
      window.GraphViewer = vi.fn(() => ({ graph, diagrams: [{}], currentPage: 0 }));

      const wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });
      await vi.waitFor(() => expect(graph.setPanning).toHaveBeenCalled());

      // container.innerHTML is cleared on re-render but the container element
      // itself survives, so a listener bound per render would multiply the step.
      store.state.diagram = { ...store.state.diagram, graphXml: '<mxGraphModel><root/></mxGraphModel>' };
      await vi.waitFor(() => expect(graph.setPanning).toHaveBeenCalledTimes(2));

      wheel(wrapper.get('.graph-viewer-canvas').element, { deltaY: -100, ctrlKey: true });
      expect(graph.zoomIn).toHaveBeenCalledTimes(1);
    });

    it('keeps the controls off the Export PNG surface', async () => {
      (window as { forgeGlobal?: unknown }).forgeGlobal = {
        forgeContext: { extension: { modal: { macroMode: 'fullscreen', openExport: true } } },
      };
      // @ts-ignore
      window.GraphViewer = vi.fn(() => ({ graph: graphStub(), diagrams: [{}], currentPage: 0 }));

      const wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });

      await vi.waitFor(() => expect(macroViewedCalls()).toHaveLength(1));
      // A zoom would change the bounds updateCaptureBox reports to the capture.
      expect(wrapper.find('[role="toolbar"]').exists()).toBe(false);
    });

    it('hides the controls when the render crashed', async () => {
      // @ts-ignore
      window.GraphViewer = vi.fn(() => {
        throw new Error('drawio init boom');
      });

      const wrapper = mount(ForgeGraphViewer, { global: { plugins: [store] } });

      await vi.waitFor(() => expect(viewerLoadFailedCalls()).toHaveLength(1));
      expect(wrapper.find('[role="toolbar"]').exists()).toBe(false);
    });
  });

});
