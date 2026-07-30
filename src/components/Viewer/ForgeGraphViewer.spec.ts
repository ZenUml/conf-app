import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForgeGraphViewer from '@/components/Viewer/ForgeGraphViewer.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import {
  viewerRenderReporterKey,
  type ViewerRenderReporter,
} from '@/utils/viewerRenderReporter';

vi.mock('@/components/Viewer/GenericViewer.vue', () => ({
  default: { name: 'GenericViewer', template: '<div><slot /></div>' },
}));

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

const graphViewer = vi.fn(function GraphViewerMock(this: Record<string, unknown>) {
  this.diagrams = [];
  this.currentPage = 0;
});
const parseXml = vi.fn(() => ({ documentElement: {} }));

describe('ForgeGraphViewer lifecycle reporter', () => {
  enableAutoUnmount(afterEach);

  const reporter: ViewerRenderReporter = {
    captureRevision: vi.fn(() => 0),
    rendered: vi.fn(),
    failed: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reporter.captureRevision).mockReturnValue(0);
    window.__macroLoadStart = 0;
    store.state.diagram = { ...NULL_DIAGRAM };
    Object.assign(globalThis, {
      mxUtils: { parseXml },
      GraphViewer: graphViewer,
    });
  });

  const mountLifecycleViewer = () => mount(ForgeGraphViewer, {
    global: {
      plugins: [store],
      provide: { [viewerRenderReporterKey as symbol]: reporter },
    },
  });

  it('does not complete from the empty loading shell', () => {
    mountLifecycleViewer();

    expect(graphViewer).not.toHaveBeenCalled();
    expect(reporter.rendered).not.toHaveBeenCalled();
  });

  it('reports the captured revision after GraphViewer constructs synchronously', async () => {
    const wrapper = mountLifecycleViewer();
    vi.mocked(reporter.captureRevision).mockReturnValue(1);

    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Graph,
      graphXml: '<mxGraphModel/>',
    };
    await wrapper.vm.$nextTick();

    expect(parseXml).toHaveBeenCalledWith('<mxGraphModel/>');
    expect(graphViewer).toHaveBeenCalledOnce();
    expect(reporter.rendered).toHaveBeenCalledWith(1);
    expect(graphViewer.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(reporter.rendered).mock.invocationCallOrder[0]);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('reports GraphViewer construction failure for the captured revision', async () => {
    const wrapper = mountLifecycleViewer();
    const error = new Error('DrawIO constructor failed');
    vi.mocked(reporter.captureRevision).mockReturnValue(2);
    graphViewer.mockImplementationOnce(() => { throw error; });

    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Graph,
      graphXml: '<mxGraphModel/>',
    };
    await wrapper.vm.$nextTick();

    expect(reporter.failed).toHaveBeenCalledWith(2, error);
    expect(reporter.rendered).not.toHaveBeenCalled();
  });

  it('keeps legacy timing for a prop-driven preview without a lifecycle', () => {
    mount(ForgeGraphViewer, {
      props: { graphXml: '<mxGraphModel/>' },
      global: { plugins: [store] },
    });

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'macro_viewed',
      expect.objectContaining({ macro_type: 'graph' }),
    );
  });
});
