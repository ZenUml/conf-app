import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

import { trackUpgradeEvent, UpgradeEventName, Persona } from '@/utils/upgradeTracking';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

describe('trackUpgradeEvent', () => {
  it('sends bystander_notice_shown as the Mixpanel event name', () => {
    trackUpgradeEvent(UpgradeEventName.BYSTANDER_NOTICE_SHOWN, { persona: Persona.BYSTANDER });
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'bystander_notice_shown',
      expect.objectContaining({ feature_area: 'upgrade', persona: 'bystander' })
    );
  });

  it('sends bystander_admin_notified as the Mixpanel event name', () => {
    trackUpgradeEvent(UpgradeEventName.BYSTANDER_ADMIN_NOTIFIED, { persona: Persona.BYSTANDER });
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'bystander_admin_notified',
      expect.objectContaining({ feature_area: 'upgrade', persona: 'bystander' })
    );
  });

  it('sends persona_comparison_view_shown as the Mixpanel event name', () => {
    trackUpgradeEvent(UpgradeEventName.COMPARISON_VIEW_SHOWN, { tenant_size_estimate: 'unknown' });
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'persona_comparison_view_shown',
      expect.objectContaining({ feature_area: 'upgrade', tenant_size_estimate: 'unknown' })
    );
  });

  it('sends upgrade_modal_shown as the Mixpanel event name', () => {
    trackUpgradeEvent(UpgradeEventName.MODAL_SHOWN, {});
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'upgrade_modal_shown',
      expect.objectContaining({ feature_area: 'upgrade' })
    );
  });

  it('sends paywall_triggered as the Mixpanel event name', () => {
    trackUpgradeEvent(UpgradeEventName.PAYWALL_TRIGGERED, {});
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'paywall_triggered',
      expect.objectContaining({ feature_area: 'upgrade' })
    );
  });
});
