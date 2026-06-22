import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ForgeGraphViewer from '@/components/Viewer/ForgeGraphViewer.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import globals from '@/model/globals';
import * as renderPerf from '@/utils/analytics/renderPerf';

const trackMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/analytics/trackRenderTime', () => ({ trackRenderTime: trackMock.fn }));

// GenericViewer pulls in paywall/store wiring; stub to a slot passthrough.
vi.mock('@/components/Viewer/GenericViewer.vue', () => ({
  default: { name: 'GenericViewer', template: '<div class="gv"><slot /></div>' },
}));

describe('ForgeGraphViewer — render_ms instrumentation', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    renderPerf._resetForTesting();
    store.state.diagram = { ...NULL_DIAGRAM };
    (globals as any).apWrapper = { isDisplayMode: () => true };
    // DrawIO globals are injected by the loaded scripts at runtime — mock them.
    (window as any).mxUtils = {
      parseXml: vi.fn(() => ({ documentElement: { nodeName: 'mxGraphModel' } })),
    };
    (window as any).GraphViewer = vi.fn(function (this: any) {
      this.diagrams = [{}];
      this.currentPage = 0;
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
    expect(trackMock.fn).toHaveBeenCalledWith('graph', true);
    // render_ms is now populated for graph (previously undefined).
    expect(typeof renderPerf.getTimings().render_ms).toBe('number');
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
