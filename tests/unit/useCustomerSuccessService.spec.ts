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
    (getFeatureFlags as any).mockResolvedValue({ CUSTOMER_SUCCESS_SERVICE: true });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    expect(svc.spacePaid.value).toBe(true);
  });

  it('exposes spacePaid = false for unpaid spaces', async () => {
    (callRemote as any).mockResolvedValue({ isPaid: false });
    (getFeatureFlags as any).mockResolvedValue({ CUSTOMER_SUCCESS_SERVICE: true });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    expect(svc.spacePaid.value).toBe(false);
  });

  it('shouldBlockActions is true when macroCount >= MACROS_LIMIT and CSS flag is on and isLite', async () => {
    localStorage.setItem('mockMacroCount', '120');
    (callRemote as any).mockResolvedValue({ isPaid: false });
    (getFeatureFlags as any).mockResolvedValue({ CUSTOMER_SUCCESS_SERVICE: true });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    expect(svc.shouldBlockActions.value).toBe(true);
    localStorage.removeItem('mockMacroCount');
  });
});
