import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';

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

import { useCustomerSuccessService, M_THRESHOLD } from '@/composables/useCustomerSuccessService';
import { callRemote } from '@/utils/requestUtil';
import getFeatureFlags from '@/apis/featureFlags';

describe('useCustomerSuccessService — persona derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module state — see implementation note below for how to expose a reset
    (useCustomerSuccessService as any).__resetForTests?.();
  });

  it('exposes persona = "creator" when personalAuthored >= M_THRESHOLD', async () => {
    (callRemote as any).mockResolvedValue({
      isPaid: false,
      personalAuthored: M_THRESHOLD,
      tenantSizeEstimate: 'medium_or_larger',
      confluenceAdmin: false,
    });
    (getFeatureFlags as any).mockResolvedValue({ CUSTOMER_SUCCESS_SERVICE: true, PERSONA_AWARE_PAYWALL: true });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    await nextTick();
    expect(svc.persona.value).toBe('creator');
  });

  it('exposes persona = "bystander" when personalAuthored < M_THRESHOLD AND not admin', async () => {
    (callRemote as any).mockResolvedValue({
      isPaid: false,
      personalAuthored: 0,
      tenantSizeEstimate: 'small_likely',
      confluenceAdmin: false,
    });
    (getFeatureFlags as any).mockResolvedValue({ CUSTOMER_SUCCESS_SERVICE: true, PERSONA_AWARE_PAYWALL: true });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    await nextTick();
    expect(svc.persona.value).toBe('bystander');
  });

  it('exposes persona = "admin" when confluenceAdmin === true (overrides authorship)', async () => {
    (callRemote as any).mockResolvedValue({
      isPaid: false,
      personalAuthored: 0,
      tenantSizeEstimate: 'medium_or_larger',
      confluenceAdmin: true,
    });
    (getFeatureFlags as any).mockResolvedValue({ CUSTOMER_SUCCESS_SERVICE: true, PERSONA_AWARE_PAYWALL: true });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    await nextTick();
    expect(svc.persona.value).toBe('admin');
  });

  it('exposes tenantSizeEstimate and personalAuthored as reactive refs', async () => {
    (callRemote as any).mockResolvedValue({
      isPaid: false,
      personalAuthored: 17,
      tenantSizeEstimate: 'small_likely',
      confluenceAdmin: false,
    });
    (getFeatureFlags as any).mockResolvedValue({ CUSTOMER_SUCCESS_SERVICE: true, PERSONA_AWARE_PAYWALL: true });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    expect(svc.personalAuthored.value).toBe(17);
    expect(svc.tenantSizeEstimate.value).toBe('small_likely');
  });

  it('personaAwarePaywallEnabled reflects the PERSONA_AWARE_PAYWALL flag', async () => {
    (callRemote as any).mockResolvedValue({ isPaid: false });
    (getFeatureFlags as any).mockResolvedValue({ CUSTOMER_SUCCESS_SERVICE: true, PERSONA_AWARE_PAYWALL: false });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    expect(svc.personaAwarePaywallEnabled.value).toBe(false);
  });

  it('localStorage.mockPersonaThreshold overrides M_THRESHOLD', async () => {
    localStorage.setItem('mockPersonaThreshold', '2');
    (callRemote as any).mockResolvedValue({
      isPaid: false,
      personalAuthored: 3,
      tenantSizeEstimate: 'medium_or_larger',
      confluenceAdmin: false,
    });
    (getFeatureFlags as any).mockResolvedValue({ CUSTOMER_SUCCESS_SERVICE: true, PERSONA_AWARE_PAYWALL: true });

    const svc = useCustomerSuccessService();
    await svc.initialize();
    expect(svc.persona.value).toBe('creator');
    localStorage.removeItem('mockPersonaThreshold');
  });
});
