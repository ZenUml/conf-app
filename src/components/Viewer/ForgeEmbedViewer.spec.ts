import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ForgeEmbedViewer from '@/components/Viewer/ForgeEmbedViewer.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';

const StubViewer = { name: 'StubViewer', template: '<div class="stub-viewer" />' };

// Renderable types resolve to a stub component; 'unknown'/'embed' -> null,
// mirroring the real loadForgeViewerComponent (CONFIGS has no Unknown/Embed).
vi.mock('@/model/Diagram/DiagramTypeConfig', () => ({
  loadForgeViewerComponent: vi.fn(async (type: string) =>
    ['sequence', 'mermaid', 'plantuml', 'graph', 'openapi'].includes(type) ? StubViewer : null,
  ),
}));

describe('ForgeEmbedViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.diagram = { ...NULL_DIAGRAM };
  });

  it('shows the loading state (no error) while the referenced doc is still NULL_DIAGRAM', async () => {
    const wrapper = mount(ForgeEmbedViewer, { global: { plugins: [store] } });
    await flushPromises();

    expect((wrapper.vm as any).error).toBeNull();
    expect(wrapper.find('.error').exists()).toBe(false);
    expect(wrapper.find('.loading').exists()).toBe(true);
  });

  it('renders the resolved viewer once the real diagramType arrives via the store', async () => {
    const wrapper = mount(ForgeEmbedViewer, { global: { plugins: [store] } });
    await flushPromises();

    // The async loadDiagram() publishes the referenced (cross-space) doc.
    store.state.diagram = { ...NULL_DIAGRAM, id: '491523', diagramType: DiagramType.PlantUml, code: 'title X' } as any;
    await flushPromises();

    expect((wrapper.vm as any).error).toBeNull();
    expect(wrapper.find('.error').exists()).toBe(false);
    expect(wrapper.findComponent(StubViewer).exists()).toBe(true);
  });

  it('regression: a valid doc arriving AFTER the initial unknown pass is not masked by a stale error', async () => {
    const wrapper = mount(ForgeEmbedViewer, { global: { plugins: [store] } });
    await flushPromises();

    store.state.diagram = { ...NULL_DIAGRAM, id: '491523', diagramType: DiagramType.PlantUml } as any;
    await flushPromises();

    expect(wrapper.text()).not.toContain('Unknown diagram type');
  });

  it('still surfaces a real error for a genuinely unrenderable type (embed → embed)', async () => {
    store.state.diagram = { ...NULL_DIAGRAM, id: '9', diagramType: DiagramType.Embed } as any;
    const wrapper = mount(ForgeEmbedViewer, { global: { plugins: [store] } });
    await flushPromises();

    expect(wrapper.find('.error').exists()).toBe(true);
    expect(wrapper.text()).toContain('Unknown diagram type: embed');
  });
});
