import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OpenApiViewer from '@/components/Viewer/OpenApiViewer.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { _resetForTesting } from '@/utils/analytics/renderPerf';
import {
  viewerRenderReporterKey,
  type ViewerRenderReporter,
} from '@/utils/viewerRenderReporter';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

const macroViewedCalls = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'macro_viewed');

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
  // The store is a module singleton; always unmount wrappers so stale watchers
  // cannot observe a later case's published revision.
  enableAutoUnmount(afterEach);

  const reporter: ViewerRenderReporter = {
    captureRevision: vi.fn(() => 0),
    rendered: vi.fn(),
    failed: vi.fn(),
  };

  const mountLifecycleViewer = () => mount(OpenApiViewer, {
    global: {
      plugins: [store],
      provide: { [viewerRenderReporterKey as symbol]: reporter },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reporter.captureRevision).mockReturnValue(0);
    _resetForTesting();
    window.ui = undefined;
    window.__macroLoadStart = 0;
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

  describe('viewer lifecycle reporter', () => {
    it('does not complete the lifecycle from the loading shell', () => {
      mountLifecycleViewer();

      expect(reporter.rendered).not.toHaveBeenCalled();
      expect(macroViewedCalls()).toHaveLength(0);
    });

    it('reports the captured revision only after handing the loaded spec to SwaggerUI', async () => {
      const wrapper = mountLifecycleViewer();
      swaggerMock.updateSpec.mockClear();
      vi.mocked(reporter.captureRevision).mockReturnValue(1);

      store.state.diagram = {
        ...NULL_DIAGRAM,
        diagramType: DiagramType.OpenApi,
        code: 'openapi: 3.0.0\ninfo:\n  title: Loaded API',
      };
      await wrapper.vm.$nextTick();

      expect(swaggerMock.updateSpec).toHaveBeenCalledWith(store.state.diagram.code);
      expect(reporter.rendered).toHaveBeenCalledWith(1);
      expect(swaggerMock.updateSpec.mock.invocationCallOrder.at(-1))
        .toBeLessThan(vi.mocked(reporter.rendered).mock.invocationCallOrder.at(-1)!);
      expect(macroViewedCalls()).toHaveLength(0);
    });

    it('reports a SwaggerUI update failure for the same captured revision', async () => {
      const wrapper = mountLifecycleViewer();
      const error = new Error('SwaggerUI rejected the spec');
      vi.mocked(reporter.captureRevision).mockReturnValue(2);
      swaggerMock.updateSpec.mockImplementationOnce(() => { throw error; });

      store.state.diagram = {
        ...NULL_DIAGRAM,
        diagramType: DiagramType.OpenApi,
        code: 'not valid OpenAPI',
      };
      await wrapper.vm.$nextTick();

      expect(reporter.failed).toHaveBeenCalledWith(2, error);
      expect(reporter.rendered).not.toHaveBeenCalled();
    });

    it('keeps legacy tracking for an editor/embed preview mounted without a lifecycle', () => {
      mount(OpenApiViewer, {
        props: { doc: { ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi, code: 'openapi: 3.0.0' } },
        global: { plugins: [store] },
      });

      expect(macroViewedCalls()).toHaveLength(1);
    });
  });
});
