import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ForgeEmbedViewer from '@/components/Viewer/ForgeEmbedViewer.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import globals from '@/model/globals';

const trackMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/analytics/trackRenderTime', () => ({ trackRenderTime: trackMock.fn }));

const loadMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/model/Diagram/DiagramTypeConfig', () => ({ loadForgeViewerComponent: loadMock.fn }));

// Stub wrapped viewer: emits 'rendered' on mount (like the real viewers do after
// renderPerf.time('render')), and accepts the embedded prop.
const StubViewer = {
  name: 'StubViewer',
  props: ['embedded', 'doc', 'graphXml', 'code', 'mermaidCode'],
  emits: ['rendered'],
  mounted() {
    (this as any).$emit('rendered');
  },
  template: '<div class="stub">stub</div>',
};

describe('ForgeEmbedViewer — single embed emit (dedup)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.diagram = { ...NULL_DIAGRAM };
    (globals as any).apWrapper = { isDisplayMode: () => true };
  });

  it('emits exactly one macro_viewed (embed + wrapped_type) when the wrapped viewer renders', async () => {
    loadMock.fn.mockResolvedValue(StubViewer);
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.b()' };
    mount(ForgeEmbedViewer, { global: { plugins: [store] } });
    await flushPromises();
    expect(trackMock.fn).toHaveBeenCalledTimes(1);
    expect(trackMock.fn).toHaveBeenCalledWith('embed', true, 'live_render', 'none', 'sequence');
  });

  it('emits one embed view with wrapped_type=none for an unknown/unresolved type', async () => {
    loadMock.fn.mockResolvedValue(null); // unknown type → renders nothing
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: 'weird' as any };
    mount(ForgeEmbedViewer, { global: { plugins: [store] } });
    await flushPromises();
    expect(trackMock.fn).toHaveBeenCalledTimes(1);
    expect(trackMock.fn).toHaveBeenCalledWith('embed', true, 'live_render', 'none', 'none');
  });

  it('does not double-emit when the wrapped viewer re-renders', async () => {
    loadMock.fn.mockResolvedValue(StubViewer);
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.b()' };
    const wrapper = mount(ForgeEmbedViewer, { global: { plugins: [store] } });
    await flushPromises();
    wrapper.findComponent(StubViewer).vm.$emit('rendered'); // second render
    await flushPromises();
    expect(trackMock.fn).toHaveBeenCalledTimes(1);
  });
});
