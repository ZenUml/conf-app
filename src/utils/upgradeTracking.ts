import { trackAnalyticsEvent } from './analytics/trackAnalyticsEvent';
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
  PAYWALL_BANNER_SHOWN = 'paywall_banner_shown',
  PAYWALL_BANNER_DISMISSED = 'paywall_banner_dismissed',
  PAYWALL_BUNDLE_CTA_CLICKED = 'paywall_bundle_cta_clicked',
  PAYWALL_MARKETPLACE_CTA_CLICKED = 'paywall_marketplace_cta_clicked',
  PAYWALL_LEARN_MORE_CLICKED = 'paywall_learn_more_clicked',
}

export enum UIComponent {
  VIEWER_NOTICE = 'viewer_notice',
  MODAL = 'modal',
}

type UpgradeEventParams = Partial<Omit<AnalyticsProperties, 'feature_area'>> & Record<string, unknown>;

/**
 * Read the client_reference_id off a Stripe Payment Link URL so the click
 * event records exactly the attribution token the payment will carry —
 * parsed from the URL actually opened, never re-derived, so the two can't
 * drift apart.
 */
export function bundleClientReferenceId(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get('client_reference_id') ?? undefined;
  } catch {
    return undefined;
  }
}

export function trackUpgradeEvent(
  eventName: UpgradeEventName,
  params: UpgradeEventParams = {}
): void {
  trackAnalyticsEvent(eventName, {
    feature_area: 'upgrade',
    surface: 'modal',
    ...params,
  });
}
