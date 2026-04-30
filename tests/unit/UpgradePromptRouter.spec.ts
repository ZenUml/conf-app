import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, computed } from 'vue';

const mockSvc = {
  persona: ref('bystander' as 'creator' | 'bystander' | 'admin'),
  personalAuthored: ref(0),
  tenantSizeEstimate: ref<'unknown' | 'small_likely' | 'medium_or_larger'>('unknown'),
  confluenceAdmin: ref(false),
  personaAwarePaywallEnabled: ref(true),
  upgradeUrl: computed(() => 'https://m'),
  enterpriseBundleUrl: computed(() => 'https://b'),
  spaceKey: ref('ENG'),
};
vi.mock('@/composables/useCustomerSuccessService', () => ({
  useCustomerSuccessService: () => mockSvc,
  getUpgradeContext: () => ({}),
}));
vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: { MODAL_SHOWN: 'upgrade_modal_shown' },
}));
vi.mock('@/components/UpgradePrompt/UpgradePrompt.vue', () => ({
  default: { name: 'LegacyPrompt', template: '<div>legacy</div>' },
}));
vi.mock('@/components/UpgradePrompt/HeavyCreatorPrompt.vue', () => ({
  default: { name: 'HeavyCreator', template: '<div>heavy</div>' },
}));
vi.mock('@/components/UpgradePrompt/BystanderNotice.vue', () => ({
  default: { name: 'BystanderNotice', template: '<div>bystander</div>' },
}));
vi.mock('@/components/UpgradePrompt/ComparisonView.vue', () => ({
  default: { name: 'ComparisonView', template: '<div>comparison</div>' },
}));

import UpgradePromptRouter from '@/components/UpgradePrompt/UpgradePromptRouter.vue';
import { trackUpgradeEvent } from '@/utils/upgradeTracking';

const baseProps = {
  visible: true,
  macrosCreated: 100,
  macrosLimit: 100,
  upgradeUrl: 'https://m',
  enterpriseBundleUrl: 'https://b',
  spaceKey: 'ENG',
};

describe('UpgradePromptRouter', () => {
  beforeEach(() => {
    mockSvc.persona.value = 'bystander';
    mockSvc.personalAuthored.value = 0;
    mockSvc.tenantSizeEstimate.value = 'unknown';
    mockSvc.confluenceAdmin.value = false;
    mockSvc.personaAwarePaywallEnabled.value = true;
    mockSvc.spaceKey.value = 'ENG';
  });

  it('renders LegacyPrompt when PERSONA_AWARE_PAYWALL flag is off', () => {
    mockSvc.personaAwarePaywallEnabled.value = false;
    mockSvc.persona.value = 'creator';
    const w = mount(UpgradePromptRouter, { props: baseProps });
    expect(w.text()).toContain('legacy');
  });

  it('renders BystanderNotice for bystander persona', () => {
    mockSvc.personaAwarePaywallEnabled.value = true;
    mockSvc.persona.value = 'bystander';
    const w = mount(UpgradePromptRouter, { props: baseProps });
    expect(w.text()).toContain('bystander');
  });

  it('renders ComparisonView when tenantSizeEstimate is unknown (admin/creator)', () => {
    mockSvc.personaAwarePaywallEnabled.value = true;
    mockSvc.persona.value = 'creator';
    mockSvc.tenantSizeEstimate.value = 'unknown';
    const w = mount(UpgradePromptRouter, { props: baseProps });
    expect(w.text()).toContain('comparison');
  });

  it('renders HeavyCreatorPrompt for creator with confident tenant size', () => {
    mockSvc.personaAwarePaywallEnabled.value = true;
    mockSvc.persona.value = 'creator';
    mockSvc.tenantSizeEstimate.value = 'small_likely';
    const w = mount(UpgradePromptRouter, { props: baseProps });
    expect(w.text()).toContain('heavy');
  });

  it('bystander → showHeavyCreator switches to HeavyCreatorPrompt', async () => {
    mockSvc.personaAwarePaywallEnabled.value = true;
    mockSvc.persona.value = 'bystander';
    mockSvc.tenantSizeEstimate.value = 'small_likely';
    const w = mount(UpgradePromptRouter, { props: baseProps });
    await (w.findComponent({ name: 'BystanderNotice' }) as any).vm.$emit('showHeavyCreator');
    expect(w.text()).toContain('heavy');
  });

  it('tracks upgrade_modal_shown for bystander/comparison variants', () => {
    mockSvc.personaAwarePaywallEnabled.value = true;
    mockSvc.persona.value = 'bystander';
    mount(UpgradePromptRouter, { props: baseProps });

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'upgrade_modal_shown',
      expect.objectContaining({ prompt_variant: 'bystander_notice' })
    );
  });
});
