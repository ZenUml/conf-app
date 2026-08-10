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
});
