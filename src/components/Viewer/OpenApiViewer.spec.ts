import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OpenApiViewer from '@/components/Viewer/OpenApiViewer.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import * as renderPerf from '@/utils/analytics/renderPerf';

// swagger-ui mock: updateSpec mirrors the real flow by firing the captured config's
// onComplete on the next microtask (real swagger schedules onComplete via setTimeout(0)
// after committing the spec). This is our render_ms settle signal.
const swaggerMock = vi.hoisted(() => {
  let lastConfig: any = null;
  const updateSpec = vi.fn(() => {
    queueMicrotask(() => lastConfig?.onComplete && lastConfig.onComplete());
  });
  const swaggerFactory = vi.fn((cfg: any) => {
    lastConfig = cfg;
    return { specActions: { updateSpec } };
  });
  return { updateSpec, swaggerFactory };
});

vi.mock('swagger-ui', () => ({
  default: Object.assign(swaggerMock.swaggerFactory, {
    presets: { apis: 'apis' },
    plugins: { DownloadUrl: 'download-url' },
  }),
}));
vi.mock('swagger-ui/dist/swagger-ui.css', () => ({}));
vi.mock('@/utils/spec-listener', () => ({ default: 'spec-listener' }));

const trackMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/analytics/trackRenderTime', () => ({ trackRenderTime: trackMock.fn }));

const OPENAPI_DOC = {
  ...NULL_DIAGRAM,
  diagramType: DiagramType.OpenApi,
  code: 'openapi: 3.0.0\ninfo:\n  title: Loaded API\n  version: 1.0.0',
};

describe('OpenApiViewer — render_ms instrumentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderPerf._resetForTesting();
    (window as any).ui = undefined;
    store.state.diagram = { ...NULL_DIAGRAM };
  });

  it('initializes SwaggerUI with an onComplete settle hook and renders the example fallback', () => {
    mount(OpenApiViewer, { global: { plugins: [store] } });
    expect(swaggerMock.swaggerFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        dom_id: '#swagger-ui',
        presets: ['apis'],
        plugins: ['download-url', 'spec-listener'],
      }),
    );
    expect((window as any).ui).toBeDefined();
    expect(swaggerMock.updateSpec).toHaveBeenCalled();
  });

  it('does NOT emit at mount; emits once after the real render settles, with render_ms populated', async () => {
    store.state.diagram = OPENAPI_DOC;
    mount(OpenApiViewer, { global: { plugins: [store] } });
    expect(trackMock.fn).not.toHaveBeenCalled(); // not emitted before the render settles
    await flushPromises();
    expect(trackMock.fn).toHaveBeenCalledTimes(1);
    expect(trackMock.fn).toHaveBeenCalledWith('openapi', expect.anything());
    expect(swaggerMock.updateSpec).toHaveBeenCalledWith(OPENAPI_DOC.code);
    // render_ms is now populated for openapi (was undefined before this fix).
    expect(typeof renderPerf.getTimings().render_ms).toBe('number');
  });

  it('emits exactly once across repeated spec updates (single-shot _tracked guard)', async () => {
    store.state.diagram = OPENAPI_DOC;
    const wrapper = mount(OpenApiViewer, { global: { plugins: [store] } });
    await flushPromises();
    store.state.diagram = { ...OPENAPI_DOC, code: `${OPENAPI_DOC.code}\n# edited` };
    await wrapper.vm.$nextTick();
    await flushPromises();
    expect(trackMock.fn).toHaveBeenCalledTimes(1);
  });

  it('still emits once if swagger-ui never fires onComplete (timeout fallback)', async () => {
    vi.useFakeTimers();
    store.state.diagram = OPENAPI_DOC;
    swaggerMock.updateSpec.mockImplementationOnce(() => {}); // no onComplete this time
    mount(OpenApiViewer, { global: { plugins: [store] } });
    await vi.advanceTimersByTimeAsync(8100);
    await flushPromises();
    expect(trackMock.fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
