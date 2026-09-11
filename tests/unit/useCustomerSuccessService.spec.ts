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
vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isLite: () => true,
      getCurrentSpace: vi.fn(async () => ({ key: 'ENG' })),
    },
  },
}));

import { useCustomerSuccessService } from '@/composables/useCustomerSuccessService';
import { callRemote } from '@/utils/requestUtil';
import getFeatureFlags from '@/apis/featureFlags';

describe('useCustomerSuccessService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useCustomerSuccessService as any).__resetForTests?.();
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

  it('shouldBlockActions stays false when macroCount >= MACROS_LIMIT and CSS flag is on and isLite (paywall block retired)', async () => {
    localStorage.setItem('mockMacroCount', '120');
    (callRemote as any).mockResolvedValue({ isPaid: false });
    (getFeatureFlags as any).mockResolvedValue({ PAYWALL_EXEMPT: false });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    expect(svc.shouldBlockActions.value).toBe(false);
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
});
