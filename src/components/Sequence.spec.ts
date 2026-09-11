import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Sequence from '@/components/Sequence.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isDisplayMode: vi.fn(() => true),
    },
  },
}));

vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
}));

// zenuml.render() is mocked per test; the constructor itself always succeeds
// and hands back this shared instance (matches how forgeIndex.ts holds a
// single module-scoped `zenuml` instance for the component's lifetime).
const zenumlInstance = vi.hoisted(() => ({ render: vi.fn(() => Promise.resolve()) }));
const ZenUmlCtor = vi.hoisted(() =>
  Object.assign(
    vi.fn(function ZenUml() {
      return zenumlInstance;
    }),
    { version: 'test' },
  ),
);
vi.mock('@zenuml/core', () => ({ default: ZenUmlCtor }));

const viewerLoadFailedCalls = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'viewer_load_failed');

describe('Sequence render-failure telemetry', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    zenumlInstance.render.mockReset().mockResolvedValue(undefined);
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Sequence,
      code: 'A.method()',
    };
  });

  it('fires viewer_load_failed when zenuml.render() throws on initial mount', async () => {
    zenumlInstance.render.mockRejectedValue(new Error('zenuml core boom'));

    mount(Sequence, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(viewerLoadFailedCalls()).toHaveLength(1);
    });
    const [, props] = viewerLoadFailedCalls()[0];
    expect(props).toMatchObject({
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'sequence',
      failure_stage: 'render_crash',
      failure_reason: 'zenuml core boom',
    });
  });

  it('fires viewer_load_failed when zenuml.render() throws on a code-change re-render (the watch path)', async () => {
    const wrapper = mount(Sequence, { global: { plugins: [store] } });
    await vi.waitFor(() => expect(zenumlInstance.render).toHaveBeenCalledTimes(1));
    expect(viewerLoadFailedCalls()).toHaveLength(0);

    zenumlInstance.render.mockRejectedValueOnce(new Error('re-render boom'));
    store.state.diagram = { ...store.state.diagram, code: 'B.method()' };
    await wrapper.vm.$nextTick();

    await vi.waitFor(() => {
      expect(viewerLoadFailedCalls()).toHaveLength(1);
    });
    const [, props] = viewerLoadFailedCalls()[0];
    expect(props).toMatchObject({
      macro_type: 'sequence',
      failure_stage: 'render_crash',
      failure_reason: 're-render boom',
    });
  });

  it('does not fire viewer_load_failed on a clean render', async () => {
    mount(Sequence, { global: { plugins: [store] } });

    await vi.waitFor(() => expect(zenumlInstance.render).toHaveBeenCalledTimes(1));
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });

  // #373: the foreign-dialect hint (ForeignDialectHint.vue) is a separate,
  // additive component — it must never change what actually gets rendered.
  // This locks in that zenuml.render() still receives PlantUML source
  // verbatim, unmodified, exactly as it did before the hint existed.
  it('renders PlantUML-looking source unchanged — the #373 hint does not alter rendering', async () => {
    const plantUmlLookingSource = [
      '@startuml',
      'autonumber',
      'actor Customer',
      'participant "Global API" as API',
      'Customer -> API: POST /shipments (Payload)',
      'activate API',
      'deactivate API',
      '@enduml',
    ].join('\n');
    store.state.diagram = {
      ...store.state.diagram,
      code: plantUmlLookingSource,
    };

    mount(Sequence, { global: { plugins: [store] } });

    await vi.waitFor(() => expect(zenumlInstance.render).toHaveBeenCalledTimes(1));
    const [renderedCode] = zenumlInstance.render.mock.calls[0];
    expect(renderedCode).toBe(plantUmlLookingSource);
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });
});

// 2026-09-01 replay (v2026.08.310610-lite): the user picked a Mermaid starter
// template while the ZenUML core chunk was still loading. Sequence.vue then
// ran `new ZenUml(this.$refs.zenuml)` against an unmounted component — the
// ref is null, React's createRoot throws #299, and viewer_load_failed fires
// for a macro that was never going to be a sequence diagram (36 events / 22
// users in the 30 days to 2026-09-08). Unmounting during the chunk load must
// be a silent no-op.
describe('Sequence unmounted while ZenUML core is still loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zenumlInstance.render.mockReset().mockResolvedValue(undefined);
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Sequence,
      code: 'A.method()',
    };
  });

  it('neither constructs ZenUML nor fires viewer_load_failed when unmounted before the chunk resolves', async () => {
    const wrapper = mount(Sequence, { global: { plugins: [store] } });
    // Unmount synchronously: `await loadZenUml()` has not resolved yet.
    wrapper.unmount();
    // Let the dynamic import and any follow-up microtasks settle.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(ZenUmlCtor).not.toHaveBeenCalled();
    expect(zenumlInstance.render).not.toHaveBeenCalled();
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });
});
