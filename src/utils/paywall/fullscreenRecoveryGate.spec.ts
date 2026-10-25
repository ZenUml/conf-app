import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountFullscreenRecovery } from './fullscreenRecoveryGate';
import { getFullscreenRecovery } from '@/apis/fullscreenRecovery';
import { mountRoot } from '@/mount-root';
vi.mock('@/apis/fullscreenRecovery', () => ({ getFullscreenRecovery: vi.fn() }));
vi.mock('@/mount-root', () => ({ mountRoot: vi.fn() }));
vi.mock('@/components/FullscreenRecoveryHost.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/model/globals/forgeGlobal', () => ({ getContext: vi.fn().mockResolvedValue({ extension: {} }), getView: vi.fn(), navigateToAppPage: vi.fn() }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));
const snapshot = { state: 'not_requested' as const, serverNow: '2026-10-24T00:00:00Z', policyVersion: 'fullscreen-contact-v1' as const };
beforeEach(() => vi.clearAllMocks());
describe('recovery policy at the viewer boundary', () => {
  it.each([false, undefined])('preserves an existing exemption unless explicitly reviewed: %s', async value => {
    vi.mocked(getFullscreenRecovery).mockResolvedValue({ ...snapshot, exemptionOverrideReviewed: value });
    expect(await mountFullscreenRecovery({ content: {}, spaceKey: 'SPACE', existingExemption: true })).toBe('disabled');
    expect(mountRoot).not.toHaveBeenCalled();
  });
  it('allows the separately reviewed pilot without changing the editor exemption', async () => {
    vi.mocked(getFullscreenRecovery).mockResolvedValue({ ...snapshot, exemptionOverrideReviewed: true });
    expect(await mountFullscreenRecovery({ content: {}, spaceKey: 'SPACE', existingExemption: true })).toBe('handled');
    expect(mountRoot).toHaveBeenCalledOnce();
  });
  it('leaves the ordinary renderer in control when the policy is unavailable', async () => {
    vi.mocked(getFullscreenRecovery).mockRejectedValue(new Error('offline'));
    expect(await mountFullscreenRecovery({ content: {}, spaceKey: 'SPACE' })).toBe('unavailable');
    expect(mountRoot).not.toHaveBeenCalled();
  });
});
