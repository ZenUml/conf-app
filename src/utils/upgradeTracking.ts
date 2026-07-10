import { trackAnalyticsEvent } from './analytics/trackAnalyticsEvent';
import type { AnalyticsEventName } from './analytics/catalog';
import type { AnalyticsProperties } from './analytics/types';

export enum UpgradeEventName {
  PAYWALL_TRIGGERED = 'paywall_triggered',
  MODAL_SHOWN = 'upgrade_modal_shown',
  MODAL_DISMISSED = 'upgrade_modal_dismissed',
  PAYWALL_BLOCKED_EDIT = 'paywall_blocked_edit',
  PAYWALL_BLOCKED_CREATE = 'paywall_blocked_create',
  PAYWALL_CONTINUED_EDITING = 'paywall_continued_editing',
  PAYWALL_CONTINUE_USED = 'paywall_continue_used',
  PAYWALL_ATTEMPTS_EXHAUSTED = 'paywall_attempts_exhausted',
  PAYWALL_GATE_EVALUATED = 'paywall_gate_evaluated',
  ADVOCACY_MESSAGE_COPIED = 'advocacy_message_copied',
  ADVOCACY_DRAFT_PREVIEW_CLICKED = 'advocacy_draft_preview_clicked',
  EXTENSION_REQUEST_CLICKED = 'extension_request_clicked',
  EXTENSION_FORM_VIEWED = 'extension_form_viewed',
  EXTENSION_FORM_SUBMITTED = 'extension_form_submitted',
  EXTENSION_FORM_FAILED = 'extension_form_failed',
  PAYWALL_BANNER_SHOWN = 'paywall_banner_shown',
  PAYWALL_BANNER_DISMISSED = 'paywall_banner_dismissed',
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
