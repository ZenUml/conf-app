import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ForgeEmbedViewer from '@/components/Viewer/ForgeEmbedViewer.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { initialViewerLoadState } from '@/utils/viewerLoadState';
import {
  viewerRenderReporterKey,
  type ViewerRenderReporter,
} from '@/utils/viewerRenderReporter';

const StubViewer = { name: 'StubViewer', template: '<div class="stub-viewer" />' };

// Renderable types resolve to a stub component; 'unknown'/'embed' -> null,
// mirroring the real loadForgeViewerComponent (CONFIGS has no Unknown/Embed).
vi.mock('@/model/Diagram/DiagramTypeConfig', () => ({
  loadForgeViewerComponent: vi.fn(async (type: string) =>
    ['sequence', 'mermaid', 'plantuml', 'graph', 'openapi'].includes(type) ? StubViewer : null,
  ),
}));

const mountViewer = () => mount(ForgeEmbedViewer, { global: { plugins: [store] } });

describe('ForgeEmbedViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.diagram = { ...NULL_DIAGRAM };
    store.state.viewerLoadState = initialViewerLoadState();
  });

  it('shows the loading state (no error) while the referenced doc is still loading', async () => {
    const wrapper = mountViewer();
    await flushPromises();

    expect((wrapper.vm as any).error).toBeNull();
    expect(wrapper.find('.error').exists()).toBe(false);
    expect(wrapper.find('.loading').exists()).toBe(true);
  });

  it('renders the resolved viewer once the real diagramType arrives via the store', async () => {
    const wrapper = mountViewer();
    await flushPromises();

    // The async loadDiagram() publishes the referenced (cross-space) doc.
    store.state.diagram = { ...NULL_DIAGRAM, id: '491523', diagramType: DiagramType.PlantUml, code: 'title X' } as any;
    store.state.viewerLoadState = { status: 'rendering', revision: 1, source: 'fetch' };
    await flushPromises();

    expect((wrapper.vm as any).error).toBeNull();
    expect(wrapper.find('.error').exists()).toBe(false);
    expect(wrapper.findComponent(StubViewer).exists()).toBe(true);
  });

  it('regression: a valid doc arriving AFTER the initial unknown pass is not masked by a stale error', async () => {
    const wrapper = mountViewer();
    await flushPromises();

    store.state.diagram = { ...NULL_DIAGRAM, id: '491523', diagramType: DiagramType.PlantUml } as any;
    store.state.viewerLoadState = { status: 'rendering', revision: 1, source: 'fetch' };
    await flushPromises();

    expect(wrapper.text()).not.toContain('Unknown diagram type');
  });

  it('shows a terminal error (not an endless spinner) when the load finishes with missing content', async () => {
    // 404 case: loadDiagram() returns undefined, so the store stays on
    // NULL_DIAGRAM ('unknown') but the load IS complete.
    const wrapper = mountViewer();
    await flushPromises();
    expect(wrapper.find('.loading').exists()).toBe(true); // still loading first

    store.state.viewerLoadState = { status: 'empty', reason: 'content_not_found' };
    await flushPromises();

    expect(wrapper.find('.loading').exists()).toBe(false);
    expect(wrapper.find('.error').exists()).toBe(true);
    expect(wrapper.text()).toContain("couldn't be loaded");
  });

  it('still surfaces a real error for a genuinely unrenderable resolved type (embed → embed)', async () => {
    store.state.diagram = { ...NULL_DIAGRAM, id: '9', diagramType: DiagramType.Embed } as any;
    store.state.viewerLoadState = { status: 'rendering', revision: 1, source: 'fetch' };
    const wrapper = mountViewer();
    await flushPromises();

    expect(wrapper.find('.error').exists()).toBe(true);
    expect(wrapper.text()).toContain('Unknown diagram type: embed');
  });

  it('reports an unsupported delegated type as a render failure for the outer Embed revision', async () => {
    const reporter: ViewerRenderReporter = {
      captureRevision: vi.fn(() => 6),
      rendered: vi.fn(),
      failed: vi.fn(),
    };
    store.state.diagram = { ...NULL_DIAGRAM, id: '9', diagramType: DiagramType.Embed } as any;
    store.state.viewerLoadState = { status: 'rendering', revision: 6, source: 'fetch' };

    mount(ForgeEmbedViewer, {
      global: {
        plugins: [store],
        provide: { [viewerRenderReporterKey as symbol]: reporter },
      },
    });
    await flushPromises();

    expect(reporter.failed).toHaveBeenCalledWith(6, expect.any(Error));
  });

  it('stops loading when target resolution or content loading fails', async () => {
    const wrapper = mountViewer();
    await flushPromises();

    store.state.viewerLoadState = { status: 'failed', reason: 'content_load' };
    await flushPromises();

    expect(wrapper.find('.loading').exists()).toBe(false);
    expect(wrapper.text()).toContain("couldn't be loaded");
  });
});
