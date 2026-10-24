import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

// --- Mocks: isolate the banner from Forge, storage, and the suppression hook ---
const track = vi.fn();
const closeView = vi.fn();
let pendingFresh = true;
let suppressed = false;

vi.mock('@forge/bridge', () => ({ view: { close: () => closeView() } }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: (...a: any[]) => track(...a),
}));
vi.mock('@/utils/csat', () => ({
  isCsatPendingFresh: () => pendingFresh,
  clearCsatPending: vi.fn(),
}));
vi.mock('@/hooks/useCSATState', () => ({
  default: () => ({
    checkStateOfCSAT: vi.fn(async () => suppressed),
    markSuppressed: vi.fn(),
    clearSuppressed: vi.fn(),
  }),
}));

import CsatBanner from '@/components/CSAT/CsatBanner.vue';

const evt = (name: string) => track.mock.calls.find((c) => c[0] === name);

describe('CsatBanner analytics', () => {
  beforeEach(() => {
    track.mockClear();
    closeView.mockClear();
    pendingFresh = true;
    suppressed = false;
  });

  it('emits csat_displayed once when the banner is shown', async () => {
    mount(CsatBanner);
    await flushPromises();
    const e = evt('csat_displayed');
    expect(e).toBeTruthy();
    expect(e![1]).toMatchObject({ feature_area: 'feedback', surface: 'editor' });
    expect(track.mock.calls.filter((c) => c[0] === 'csat_displayed')).toHaveLength(1);
  });

  it('does NOT emit csat_displayed on the no-trigger close path', async () => {
    pendingFresh = false;
    mount(CsatBanner);
    await flushPromises();
    expect(evt('csat_displayed')).toBeFalsy();
    expect(closeView).toHaveBeenCalled();
  });

  it('does NOT emit csat_displayed when the user is suppressed', async () => {
    suppressed = true;
    mount(CsatBanner);
    await flushPromises();
    expect(evt('csat_displayed')).toBeFalsy();
    expect(closeView).toHaveBeenCalled();
  });

  it('emits csat_submitted with the 1-5 rating (face index + 1)', async () => {
    const w = mount(CsatBanner);
    await flushPromises();
    await w.find('button[aria-label^="5 of 5"]').trigger('click'); // index 4 -> 5
    await w.find('button.pb-link-brand').trigger('click'); // Send
    const e = evt('csat_submitted');
    expect(e).toBeTruthy();
    expect(e![1]).toMatchObject({ feedback_score: 5 });
  });

  it('emits csat_dismissed; feedback_score undefined when no face was picked', async () => {
    const w = mount(CsatBanner);
    await flushPromises();
    await w.find('button.pb-link:not(.pb-link-brand)').trigger('click'); // Dismiss (no rating)
    const e = evt('csat_dismissed');
    expect(e).toBeTruthy();
    expect(e![1].feedback_score).toBeUndefined();
  });

  it('emits csat_dismissed with the rating when a face was picked first', async () => {
    const w = mount(CsatBanner);
    await flushPromises();
    await w.find('button[aria-label^="2 of 5"]').trigger('click'); // index 1 -> 2, moves to 'feedback'
    await w.find('button.pb-link:not(.pb-link-brand)').trigger('click'); // Dismiss
    const e = evt('csat_dismissed');
    expect(e).toBeTruthy();
    expect(e![1]).toMatchObject({ feedback_score: 2 });
  });
});
