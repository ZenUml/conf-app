import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForgeGraphViewerEmbed from '@/components/Viewer/ForgeGraphViewerEmbed.vue';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import {
  viewerRenderReporterKey,
  type ViewerRenderReporter,
} from '@/utils/viewerRenderReporter';

const drawio = vi.hoisted(() => ({
  ensureDrawioViewerLoaded: vi.fn(async () => undefined),
}));
vi.mock('@/utils/drawio/loadDrawioViewer', () => drawio);
vi.mock('@/components/Viewer/GenericViewer.vue', () => ({
  default: { name: 'GenericViewer', template: '<div><slot /></div>' },
}));

const graphViewer = vi.fn(function GraphViewerMock(this: Record<string, unknown>) {
  this.diagrams = [];
  this.currentPage = 0;
});
const parseXml = vi.fn(() => ({ documentElement: {} }));

describe('ForgeGraphViewerEmbed lifecycle reporter', () => {
  const reporter: ViewerRenderReporter = {
    captureRevision: vi.fn(() => 4),
    rendered: vi.fn(),
    failed: vi.fn(),
  };
  const doc = {
    ...NULL_DIAGRAM,
    diagramType: DiagramType.Graph,
    graphXml: '<mxGraphModel/>',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reporter.captureRevision).mockReturnValue(4);
    drawio.ensureDrawioViewerLoaded.mockResolvedValue(undefined);
    Object.assign(globalThis, { mxUtils: { parseXml } });
    window.GraphViewer = graphViewer as any;
  });

  const mountViewer = () => mount(ForgeGraphViewerEmbed, {
    props: { doc },
    global: { provide: { [viewerRenderReporterKey as symbol]: reporter } },
  });

  it('completes the outer Embed revision after GraphViewer constructs', async () => {
    mountViewer();
    await flushPromises();

    expect(graphViewer).toHaveBeenCalledOnce();
    expect(reporter.rendered).toHaveBeenCalledWith(4);
  });

  it('reports DrawIO script loading failure to the outer Embed revision', async () => {
    const error = new Error('DrawIO chunk failed');
    drawio.ensureDrawioViewerLoaded.mockRejectedValueOnce(error);

    mountViewer();
    await flushPromises();

    expect(reporter.failed).toHaveBeenCalledWith(4, error);
    expect(reporter.rendered).not.toHaveBeenCalled();
  });
});
