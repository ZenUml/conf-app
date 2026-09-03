import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

import { trackUpgradeEvent, UpgradeEventName } from '@/utils/upgradeTracking';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

describe('trackUpgradeEvent', () => {
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

  it('sends paywall_continued_editing as the Mixpanel event name', () => {
    trackUpgradeEvent(UpgradeEventName.PAYWALL_CONTINUED_EDITING);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'paywall_continued_editing',
      expect.objectContaining({ feature_area: 'upgrade' })
    );
  });

  it('sends the four pricing-survey events under their catalog names', () => {
    const expected: Array<[UpgradeEventName, string]> = [
      [UpgradeEventName.PAYWALL_SURVEY_SHOWN, 'paywall_survey_shown'],
      [UpgradeEventName.PAYWALL_SURVEY_ANSWERED, 'paywall_survey_answered'],
      [UpgradeEventName.PAYWALL_SURVEY_SUBMITTED, 'paywall_survey_submitted'],
      [UpgradeEventName.PAYWALL_SURVEY_SKIPPED, 'paywall_survey_skipped'],
    ];
    for (const [event, name] of expected) {
      trackUpgradeEvent(event, {});
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        name,
        expect.objectContaining({ feature_area: 'upgrade' })
      );
    }
  });
});
