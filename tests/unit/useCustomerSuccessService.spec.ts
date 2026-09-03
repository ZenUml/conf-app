import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }));
vi.mock('@/apis/featureFlags', () => ({
  default: vi.fn(),
}));
vi.mock('@/services/MacroMetrics', () => ({
  default: { getMacroMetrics: vi.fn(async () => ({ total: 50 })) },
}));
vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: { FEATURE_ENABLED: 'upgrade_feature_enabled' },
}));
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'acme.atlassian.net',
  getSpaceKey: () => 'ENG',
}));
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: { accountId: 'account-123' } },
}));
vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isLite: () => true,
      getCurrentSpace: vi.fn(async () => ({ key: 'ENG' })),
    },
  },
}));

import {
  useCustomerSuccessService,
  PAYWALL_GRANT_MARKER_TTL_MS,
} from '@/composables/useCustomerSuccessService';
import { callRemote } from '@/utils/requestUtil';
import getFeatureFlags from '@/apis/featureFlags';

const GRANT_MARKER_KEY = 'paywallGrantAt:acme.atlassian.net:ENG:account-123';

describe('useCustomerSuccessService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useCustomerSuccessService as any).__resetForTests?.();
    localStorage.removeItem(GRANT_MARKER_KEY);
  });

  it('exposes spacePaid = true for paid spaces', async () => {
    (callRemote as any).mockResolvedValue({ isPaid: true, source: 'space_license' });
    (getFeatureFlags as any).mockResolvedValue({ PAYWALL_EXEMPT: false });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    expect(svc.spacePaid.value).toBe(true);
  });

  it('exposes spacePaid = false for unpaid spaces', async () => {
    (callRemote as any).mockResolvedValue({ isPaid: false });
    (getFeatureFlags as any).mockResolvedValue({ PAYWALL_EXEMPT: false });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    expect(svc.spacePaid.value).toBe(false);
  });

  it('shouldBlockActions is true when macroCount >= MACROS_LIMIT and CSS flag is on and isLite', async () => {
    localStorage.setItem('mockMacroCount', '120');
    (callRemote as any).mockResolvedValue({ isPaid: false });
    (getFeatureFlags as any).mockResolvedValue({ PAYWALL_EXEMPT: false });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    expect(svc.shouldBlockActions.value).toBe(true);
    expect(JSON.parse(localStorage.getItem('paywallWarning:acme.atlassian.net:ENG') || '{}')).toMatchObject({
      macroCount: 120,
      spacePaid: false,
      customerSuccessServiceEnabled: true,
    });
    expect(svc.paywallPolicySource.value).toBe('default_on');
    localStorage.removeItem('mockMacroCount');
  });

  it('an explicit exemption stores the effective boolean (false) on the legacy page-banner marker field', async () => {
    localStorage.setItem('mockMacroCount', '120');
    (callRemote as any).mockResolvedValue({ isPaid: false });
    (getFeatureFlags as any).mockResolvedValue({ PAYWALL_EXEMPT: true });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    expect(svc.shouldBlockActions.value).toBe(false);
    expect(svc.paywallPolicySource.value).toBe('exemption');
    expect(JSON.parse(localStorage.getItem('paywallWarning:acme.atlassian.net:ENG') || '{}')).toMatchObject({
      macroCount: 120,
      spacePaid: false,
      customerSuccessServiceEnabled: false,
    });
    localStorage.removeItem('mockMacroCount');
  });

  describe('markSpacePaid', () => {
    it('flips the space to paid, records the source, and writes the grant marker', async () => {
      (callRemote as any).mockResolvedValue({ isPaid: false });
      (getFeatureFlags as any).mockResolvedValue({ PAYWALL_EXEMPT: false });

      const svc = useCustomerSuccessService();
      await svc.initialize();
      expect(svc.spacePaid.value).toBe(false);

      svc.markSpacePaid('user_license');

      expect(svc.spacePaid.value).toBe(true);
      expect(svc.spacePaidSource.value).toBe('user_license');
      expect(svc.shouldBlockActions.value).toBe(false);
      // The page-banner targeting marker is refreshed too, so the banner on the
      // next page load agrees with the modal the user just closed.
      expect(
        JSON.parse(localStorage.getItem('paywallWarning:acme.atlassian.net:ENG') || '{}')
      ).toMatchObject({ spacePaid: true });

      const grantedAt = localStorage.getItem(GRANT_MARKER_KEY);
      expect(grantedAt).toBeTruthy();
      expect(Date.now() - new Date(grantedAt as string).getTime()).toBeLessThan(5000);
    });

    it('a later status read cannot undo the grant within the session', async () => {
      (callRemote as any).mockResolvedValue({ isPaid: false });
      (getFeatureFlags as any).mockResolvedValue({ PAYWALL_EXEMPT: false });

      const svc = useCustomerSuccessService();
      await svc.initialize();
      svc.markSpacePaid('user_license');
      await svc.initialize();

      expect(svc.spacePaid.value).toBe(true);
    });
  });

  describe('space-status cache busting after a grant', () => {
    it('busts the 5-minute cached response while the grant marker is fresh', async () => {
      localStorage.setItem(GRANT_MARKER_KEY, new Date().toISOString());
      (callRemote as any).mockResolvedValue({ isPaid: true, source: 'user_license' });
      (getFeatureFlags as any).mockResolvedValue({ PAYWALL_EXEMPT: false });

      const svc = useCustomerSuccessService();
      await svc.initialize();

      const url = (callRemote as any).mock.calls[0][0] as string;
      expect(url).toMatch(/^\/api\/space-status\?spaceKey=ENG&_=\d+$/);
    });

    it('stops busting and clears the marker once it is older than the window', async () => {
      const stale = new Date(Date.now() - PAYWALL_GRANT_MARKER_TTL_MS - 1000).toISOString();
      localStorage.setItem(GRANT_MARKER_KEY, stale);
      (callRemote as any).mockResolvedValue({ isPaid: false });
      (getFeatureFlags as any).mockResolvedValue({ PAYWALL_EXEMPT: false });

      const svc = useCustomerSuccessService();
      await svc.initialize();

      expect((callRemote as any).mock.calls[0][0]).toBe('/api/space-status?spaceKey=ENG');
      expect(localStorage.getItem(GRANT_MARKER_KEY)).toBeNull();
    });

    it('makes no cache-busted request when there was never a grant', async () => {
      (callRemote as any).mockResolvedValue({ isPaid: false });
      (getFeatureFlags as any).mockResolvedValue({ PAYWALL_EXEMPT: false });

      const svc = useCustomerSuccessService();
      await svc.initialize();

      expect((callRemote as any).mock.calls[0][0]).toBe('/api/space-status?spaceKey=ENG');
    });
  });
});
