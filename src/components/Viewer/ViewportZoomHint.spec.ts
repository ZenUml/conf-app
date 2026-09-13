import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ViewportZoomHint from '@/components/Viewer/ViewportZoomHint.vue';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

const hintCalls = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'viewport_zoom_hint_shown');

/** `isDisplayMode` false is the editor preview, one of the two hinted surfaces. */
function mountHint(isDisplayMode = false) {
  return mount(ViewportZoomHint, {
    props: { macroType: 'plantuml' },
    global: { mocks: { $store: { getters: { isDisplayMode } } } },
  });
}

describe('ViewportZoomHint', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as { forgeGlobal?: unknown }).forgeGlobal;
  });

  it('stays out of the way until the parent asks for it', () => {
    const wrapper = mountHint();
    expect(wrapper.find('.viewport-zoom-hint').exists()).toBe(false);
    expect(hintCalls()).toHaveLength(0);
  });

  it('shows the modifier and records the telling', async () => {
    const wrapper = mountHint();

    wrapper.vm.show();
    await wrapper.vm.$nextTick();

    const hint = wrapper.get('.viewport-zoom-hint');
    expect(hint.text()).toContain('scroll to zoom');
    // A mouse gesture is not an affordance a screen-reader user can take.
    expect(hint.attributes('aria-hidden')).toBe('true');
    expect(hintCalls()).toHaveLength(1);
    expect(hintCalls()[0][1]).toMatchObject({
      feature_area: 'macro',
      surface: 'editor',
      macro_type: 'plantuml',
    });
  });

  it('reads the fullscreen surface off the macro context', async () => {
    (window as { forgeGlobal?: unknown }).forgeGlobal = {
      forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } },
    };
    const wrapper = mountHint(true);

    wrapper.vm.show();
    await wrapper.vm.$nextTick();

    expect(hintCalls()[0][1]).toMatchObject({ surface: 'fullscreen' });
  });

  it('extends rather than re-counts while it is already up', async () => {
    const wrapper = mountHint();

    wrapper.vm.show();
    vi.advanceTimersByTime(2000);
    wrapper.vm.show();
    await wrapper.vm.$nextTick();

    // The reader is looking at the same message: one telling, not two.
    expect(hintCalls()).toHaveLength(1);
    // ...and the second call restarted the clock, so it is still up.
    vi.advanceTimersByTime(1000);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.viewport-zoom-hint').exists()).toBe(true);
  });

  it('takes itself down again', async () => {
    const wrapper = mountHint();

    wrapper.vm.show();
    vi.advanceTimersByTime(3000);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.viewport-zoom-hint').exists()).toBe(false);
  });
});
