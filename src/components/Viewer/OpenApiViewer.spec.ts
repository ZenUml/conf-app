import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OpenApiViewer from '@/components/Viewer/OpenApiViewer.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';

const swaggerMock = vi.hoisted(() => {
  const updateSpec = vi.fn();
  const swaggerFactory = vi.fn(() => ({
    specActions: { updateSpec },
  }));
  return { updateSpec, swaggerFactory };
});

vi.mock('swagger-ui', () => ({
  default: Object.assign(swaggerMock.swaggerFactory, {
    presets: { apis: 'apis' },
    plugins: { DownloadUrl: 'download-url' },
  }),
}));

vi.mock('swagger-ui/dist/swagger-ui.css', () => ({}));

vi.mock('@/utils/spec-listener', () => ({
  default: 'spec-listener',
}));

vi.mock('@/components/Viewer/GenericViewer.vue', () => ({
  default: {
    name: 'GenericViewer',
    template: '<div class="generic-viewer"><slot /></div>',
  },
}));

describe('OpenApiViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.ui = undefined;
    store.state.diagram = { ...NULL_DIAGRAM };
  });

  it('initializes SwaggerUI after its own DOM node is mounted even without a doc prop', () => {
    mount(OpenApiViewer, {
      global: { plugins: [store] },
    });

    expect(swaggerMock.swaggerFactory).toHaveBeenCalledWith({
      dom_id: '#swagger-ui',
      presets: ['apis'],
      plugins: ['download-url', 'spec-listener'],
    });
    expect(window.ui).toBeDefined();
    expect(swaggerMock.updateSpec).toHaveBeenCalled();
  });

  it('updates SwaggerUI when the loaded diagram is published to the store', async () => {
    const wrapper = mount(OpenApiViewer, {
      global: { plugins: [store] },
    });
    swaggerMock.updateSpec.mockClear();

    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.OpenApi,
      code: 'openapi: 3.0.0\ninfo:\n  title: Loaded API\n  version: 1.0.0',
    };
    await wrapper.vm.$nextTick();

    expect(swaggerMock.updateSpec).toHaveBeenCalledWith(store.state.diagram.code);
  });
});
