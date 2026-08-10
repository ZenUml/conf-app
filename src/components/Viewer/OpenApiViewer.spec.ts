import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OpenApiViewer from '@/components/Viewer/OpenApiViewer.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { time as timePhase, _resetForTesting } from '@/utils/analytics/renderPerf';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

const macroViewedCalls = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'macro_viewed');
const viewerLoadFailedCalls = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'viewer_load_failed');

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
  // The store is a module singleton: a wrapper left mounted by an earlier case
  // keeps watching it, so a later `diagramLoadComplete` flip would fire that
  // stale instance's reporter too and inflate the counts below.
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    window.ui = undefined;
    window.__macroLoadStart = 0;
    store.state.diagram = { ...NULL_DIAGRAM };
    store.state.diagramLoadComplete = false;
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

  // #413. The OpenAPI entry mounts this component before its content load
  // resolves, so reporting from mounted() both timed an empty skeleton and
  // snapshotted renderPerf before any fetch phase existed — openapi shipped
  // zero fetch_ms/custom_content_fetch_ms/page_adf_fetch_ms for 1,187
  // production renders before anyone noticed.
  describe('macro_viewed reporting', () => {
    it('waits for the content load to settle instead of reporting at mount', async () => {
      const wrapper = mount(OpenApiViewer, { global: { plugins: [store] } });

      expect(macroViewedCalls()).toHaveLength(0);

      store.state.diagramLoadComplete = true;
      await wrapper.vm.$nextTick();

      expect(macroViewedCalls()).toHaveLength(1);
    });

    it('carries the fetch phase recorded during the load', async () => {
      const wrapper = mount(OpenApiViewer, { global: { plugins: [store] } });
      // Stand in for viewerBootstrap's wrapped load, which records the phase
      // after this component has already mounted.
      await timePhase('fetch', async () => undefined);

      store.state.diagramLoadComplete = true;
      await wrapper.vm.$nextTick();

      const [, props] = macroViewedCalls()[0];
      expect(props.macro_type).toBe('openapi');
      expect(props.fetch_ms).toBeTypeOf('number');
    });

    it('reports once, not once per store mutation', async () => {
      const wrapper = mount(OpenApiViewer, { global: { plugins: [store] } });
      store.state.diagramLoadComplete = true;
      await wrapper.vm.$nextTick();

      store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi, code: 'openapi: 3.0.0' };
      await wrapper.vm.$nextTick();

      expect(macroViewedCalls()).toHaveLength(1);
    });

    it('reports a failed load too — macro_viewed is readership, not success', async () => {
      const wrapper = mount(OpenApiViewer, { global: { plugins: [store] } });

      // publishLoadedDiagram(undefined): the doc never arrived, but the load
      // did settle.
      store.state.diagramLoadComplete = true;
      await wrapper.vm.$nextTick();

      expect(macroViewedCalls()).toHaveLength(1);
    });

    it('reports at mount when the content is already in hand (embed host, editor preview)', () => {
      mount(OpenApiViewer, {
        props: { doc: { ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi, code: 'openapi: 3.0.0' } },
        global: { plugins: [store] },
      });

      expect(macroViewedCalls()).toHaveLength(1);
    });
  });

  // reliability-audit-2026-08-06 §4/§12.2 (conf-app#149/#150): this file had
  // zero error handling of any kind — `grep -n "error|Error|catch|failed"`
  // returned no matches. 12.4% of view volume (graph+openapi+embed) had no
  // failure telemetry at all.
  describe('render-failure telemetry', () => {
    it('fires viewer_load_failed when SwaggerUIBundle construction throws', () => {
      swaggerMock.swaggerFactory.mockImplementationOnce(() => {
        throw new Error('swagger-ui init boom');
      });

      mount(OpenApiViewer, { global: { plugins: [store] } });

      expect(viewerLoadFailedCalls()).toHaveLength(1);
      expect(viewerLoadFailedCalls()[0][1]).toMatchObject({
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: 'openapi',
        failure_stage: 'render_crash',
        failure_reason: 'swagger-ui init boom',
      });
    });

    it('fires viewer_load_failed when specActions.updateSpec throws, and still reports macro_viewed once the load settles — macro_viewed is readership, not success', async () => {
      swaggerMock.updateSpec.mockImplementationOnce(() => {
        throw new Error('bad spec boom');
      });

      const wrapper = mount(OpenApiViewer, { global: { plugins: [store] } });

      expect(viewerLoadFailedCalls()).toHaveLength(1);
      expect(viewerLoadFailedCalls()[0][1]).toMatchObject({
        macro_type: 'openapi',
        failure_stage: 'render_crash',
        failure_reason: 'bad spec boom',
      });

      // A construction/updateSpec crash must not break the mounted() lifecycle
      // that follows it — reportRenderOnce() still needs to run.
      store.state.diagramLoadComplete = true;
      await wrapper.vm.$nextTick();
      expect(macroViewedCalls()).toHaveLength(1);
    });

    it('does not fire viewer_load_failed on a clean render', () => {
      mount(OpenApiViewer, { global: { plugins: [store] } });

      expect(viewerLoadFailedCalls()).toHaveLength(0);
    });
  });
});
