import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: { COMPARISON_VIEW_SHOWN: 'persona_comparison_view_shown', CTA_CLICKED: 'upgrade_cta_clicked' },
  Persona: {}, ProductOption: { MARKETPLACE: 'marketplace', ENTERPRISE_BUNDLE: 'enterprise_bundle' }, UIComponent: { TOOLTIP: 'tooltip' },
}));
vi.mock('@/components/UpgradePrompt/MarketplacePricingCard.vue', () => ({ default: { template: '<div>marketplace-card</div>' } }));
vi.mock('@/components/UpgradePrompt/EnterpriseBundleCard.vue', () => ({ default: { template: '<div>bundle-card</div>' } }));

import ComparisonView from '@/components/UpgradePrompt/ComparisonView.vue';
import { trackUpgradeEvent } from '@/utils/upgradeTracking';

describe('ComparisonView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders both cards and tracks impression on visible', () => {
    mount(ComparisonView, {
      props: { visible: true, upgradeUrl: 'https://m', enterpriseBundleUrl: 'https://b' },
      attachTo: document.body,
    });
    expect(document.body.textContent).toContain('marketplace-card');
    expect(document.body.textContent).toContain('bundle-card');
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'persona_comparison_view_shown',
      expect.objectContaining({ tenant_size_estimate: 'unknown' })
    );
  });
});
