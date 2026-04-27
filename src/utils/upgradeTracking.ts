import { trackAnalyticsEvent } from './analytics/trackAnalyticsEvent';
import type { AnalyticsEventName } from './analytics/catalog';
import type { AnalyticsProperties } from './analytics/types';

export enum UpgradeEventName {
  CTA_CLICKED = 'upgrade_cta_clicked',
  PROMPT_HOVERED = 'upgrade_prompt_hovered',
  FEATURE_ENABLED = 'upgrade_feature_enabled',
  ACTION_BLOCKED = 'upgrade_action_blocked',
  MODAL_SHOWN = 'upgrade_modal_shown',
  SLIDER_CHANGED = 'upgrade_slider_changed',
  MODAL_DISMISSED = 'upgrade_modal_dismissed',
  PROMPT_SHOWN = 'upgrade_prompt_shown',
  TOOLTIP_SHOWN = 'upgrade_tooltip_shown',
  // Persona-aware paywall events
  BYSTANDER_NOTICE_SHOWN = 'bystander_notice_shown',
  BYSTANDER_ADMIN_NOTIFIED = 'bystander_admin_notified',
  BYSTANDER_OWNER_SELF_IDENTIFY = 'bystander_owner_self_identify',
  COMPARISON_VIEW_SHOWN = 'persona_comparison_view_shown',
}

export enum Persona {
  CREATOR = 'creator',
  BYSTANDER = 'bystander',
}

export enum ProductOption {
  MARKETPLACE = 'marketplace',
  ENTERPRISE_BUNDLE = 'enterprise_bundle',
  UNKNOWN = 'unknown',
}

export enum UIComponent {
  HEADER_BADGE = 'header_badge',
  TOOLTIP = 'tooltip',
  VIEWER_NOTICE = 'viewer_notice',
  BANNER = 'banner',
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
