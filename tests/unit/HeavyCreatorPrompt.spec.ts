import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: { MODAL_SHOWN: 'upgrade_modal_shown', CTA_CLICKED: 'upgrade_cta_clicked' },
  Persona: { CREATOR: 'creator', ADMIN: 'admin' },
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

  it('non-admin → Bundle is primary', () => {
    mount(HeavyCreatorPrompt, {
      props: { ...baseProps, tenantSizeEstimate: 'small_likely', confluenceAdmin: false },
      attachTo: document.body,
    });
    const primary = document.querySelector('[data-testid="primary-cta"]') as HTMLElement;
    // Bundle primary CTA reads "Unlock this space — $299/yr →"
    expect(primary?.textContent).toMatch(/\$299/);
    expect(primary?.textContent).not.toMatch(/marketplace/i);
  });

  it('admin + small_likely → Marketplace is primary', () => {
    mount(HeavyCreatorPrompt, {
      props: { ...baseProps, tenantSizeEstimate: 'small_likely', confluenceAdmin: true },
      attachTo: document.body,
    });
    const primary = document.querySelector('[data-testid="primary-cta"]') as HTMLElement;
    expect(primary?.textContent).toMatch(/marketplace/i);
  });

  it('admin + medium_or_larger → Bundle is primary', () => {
    mount(HeavyCreatorPrompt, {
      props: { ...baseProps, tenantSizeEstimate: 'medium_or_larger', confluenceAdmin: true },
      attachTo: document.body,
    });
    const primary = document.querySelector('[data-testid="primary-cta"]') as HTMLElement;
    expect(primary?.textContent).toMatch(/\$299/);
    expect(primary?.textContent).not.toMatch(/marketplace/i);
  });
});
