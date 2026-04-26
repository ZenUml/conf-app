import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: { MODAL_SHOWN: 'upgrade_modal_shown', CTA_CLICKED: 'upgrade_cta_clicked' },
  Persona: { CREATOR: 'creator', BYSTANDER: 'bystander' },
  ProductOption: { MARKETPLACE: 'marketplace', ENTERPRISE_BUNDLE: 'enterprise_bundle' },
  UIComponent: { TOOLTIP: 'tooltip' },
}));
vi.mock('@/model/globals/forgeGlobal', () => ({ openUrl: vi.fn() }));

import HeavyCreatorPrompt from '@/components/UpgradePrompt/HeavyCreatorPrompt.vue';

const baseProps = {
  visible: true,
  personalAuthored: 7,
  upgradeUrl: 'https://marketplace/...',
  enterpriseBundleUrl: 'https://buy.stripe.com/...',
};

describe('HeavyCreatorPrompt — dynamic ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('Bundle is always primary, Marketplace is secondary', () => {
    mount(HeavyCreatorPrompt, {
      props: { ...baseProps, tenantSizeEstimate: 'small_likely' },
      attachTo: document.body,
    });
    const primary = document.querySelector('[data-testid="primary-cta"]') as HTMLElement;
    expect(primary?.textContent).toMatch(/\$299/);
    expect(primary?.textContent).not.toMatch(/marketplace/i);
    const secondary = document.querySelector('[data-testid="secondary-cta"]') as HTMLElement;
    expect(secondary?.textContent).toMatch(/marketplace/i);
  });
});
