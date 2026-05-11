import { trackAnalyticsEvent } from './analytics/trackAnalyticsEvent';
import type { AnalyticsEventName } from './analytics/catalog';
import type { AnalyticsProperties } from './analytics/types';

export enum UpgradeEventName {
  FEATURE_ENABLED = 'upgrade_feature_enabled',
  PAYWALL_TRIGGERED = 'paywall_triggered',
  MODAL_SHOWN = 'upgrade_modal_shown',
  MODAL_DISMISSED = 'upgrade_modal_dismissed',
  PAYWALL_BLOCKED_EDIT = 'paywall_blocked_edit',
  PAYWALL_CONTINUED_EDITING = 'paywall_continued_editing',
  ADVOCACY_MESSAGE_COPIED = 'advocacy_message_copied',
  ADVOCACY_DRAFT_PREVIEW_CLICKED = 'advocacy_draft_preview_clicked',
}

export enum UIComponent {
  HEADER_BADGE = 'header_badge',
  TOOLTIP = 'tooltip',
  VIEWER_NOTICE = 'viewer_notice',
  BANNER = 'banner',
  MODAL = 'modal',
}

type UpgradeEventParams = Partial<Omit<AnalyticsProperties, 'feature_area'>> & Record<string, unknown>;

export function trackUpgradeEvent(
  eventName: UpgradeEventName,
  params: UpgradeEventParams = {}
): void {
  trackAnalyticsEvent(eventName as AnalyticsEventName, {
    feature_area: 'upgrade',
    surface: 'modal',
    ...params,
  });
}
