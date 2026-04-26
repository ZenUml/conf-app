import { trackEvent } from './window';

/**
 * Standardized upgrade event tracking
 *
 * This module provides a unified way to track upgrade-related events with consistent
 * naming, proper action/category mapping, and automatic context enrichment.
 */

export enum UpgradeEventName {
  CTA_CLICKED = 'upgrade_cta_clicked',
  PROMPT_HOVERED = 'upgrade_prompt_hovered',
  FEATURE_ENABLED = 'upgrade_feature_enabled',
  ACTION_BLOCKED = 'upgrade_action_blocked',
  MODAL_SHOWN = 'upgrade_modal_shown',
  SLIDER_CHANGED = 'upgrade_slider_changed',
  MODAL_DISMISSED = 'upgrade_modal_dismissed',
  // Reserved for future expansion
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
  ADMIN = 'admin',
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

interface UpgradeEventParams {
  product_option?: ProductOption;
  ui_component?: UIComponent;
  cta_position?: 'primary' | 'secondary';
  persona?: Persona;
  [key: string]: any;
}

/**
 * Maps event names to their corresponding action and category
 * Maintains compatibility with existing analytics system
 */
const EVENT_CONFIG: Record<UpgradeEventName, { action: string; category: string }> = {
  [UpgradeEventName.CTA_CLICKED]: { action: 'click', category: 'conversion' },
  [UpgradeEventName.PROMPT_HOVERED]: { action: 'hover', category: 'conversion' },
  [UpgradeEventName.FEATURE_ENABLED]: { action: 'system', category: 'info' },
  [UpgradeEventName.ACTION_BLOCKED]: { action: 'blocked', category: 'conversion' },
  [UpgradeEventName.MODAL_SHOWN]: { action: 'impression', category: 'conversion' },
  [UpgradeEventName.SLIDER_CHANGED]: { action: 'interaction', category: 'conversion' },
  [UpgradeEventName.MODAL_DISMISSED]: { action: 'dismiss', category: 'conversion' },
  [UpgradeEventName.PROMPT_SHOWN]: { action: 'impression', category: 'conversion' },
  [UpgradeEventName.TOOLTIP_SHOWN]: { action: 'impression', category: 'conversion' },
  [UpgradeEventName.BYSTANDER_NOTICE_SHOWN]: { action: 'impression', category: 'conversion' },
  [UpgradeEventName.BYSTANDER_ADMIN_NOTIFIED]: { action: 'click', category: 'conversion' },
  [UpgradeEventName.BYSTANDER_OWNER_SELF_IDENTIFY]: { action: 'click', category: 'conversion' },
  [UpgradeEventName.COMPARISON_VIEW_SHOWN]: { action: 'impression', category: 'conversion' },
};

/**
 * Unified upgrade event tracking function
 * Automatically selects the correct action and category based on event type
 *
 * @param eventName - The type of event to track
 * @param params - Additional parameters including product_option, ui_component, etc.
 *
 * @example
 * trackUpgradeEvent(UpgradeEventName.CTA_CLICKED, {
 *   product_option: ProductOption.MARKETPLACE,
 *   ui_component: UIComponent.TOOLTIP,
 *   cta_position: 'primary',
 *   ...getUpgradeContext(),
 * })
 */
export function trackUpgradeEvent(
  eventName: UpgradeEventName,
  params: UpgradeEventParams = {}
) {
  const config = EVENT_CONFIG[eventName];
  trackEvent(
    eventName,        // label: clear event name
    config.action,    // action: mapped based on event type (click/hover/system/impression)
    config.category,  // category: conversion or info
    params
  );
}
