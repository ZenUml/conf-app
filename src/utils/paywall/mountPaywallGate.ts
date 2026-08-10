import { Component } from 'vue';
import globals from '@/model/globals';
import { mountRoot } from '@/mount-root';
import { Diagram, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import PaywallGate from '@/components/UpgradePrompt/PaywallGate.vue';
import type { MacroKind } from '@/components/UpgradePrompt/buildAdvocacyMessage';
import {
  useCustomerSuccessService,
  MACROS_LIMIT,
  getUpgradeContext,
} from '@/composables/useCustomerSuccessService';
import {
  default as forgeGlobal,
  getView,
  isFullscreenMode,
  isEditorMode,
} from '@/model/globals/forgeGlobal';
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters';
import {
  trackUpgradeEvent,
  UpgradeEventName,
  UIComponent,
} from '@/utils/upgradeTracking';
import {
  isFullscreenViewerBlocked,
  isPageEditorEditBlocked,
  isPageEditorCreateBlocked,
} from '@/utils/paywall/preEditGate';

type CustomerSuccess = ReturnType<typeof useCustomerSuccessService>;

/**
 * Emit `paywall_gate_evaluated` for one gate decision — fired on every Lite
 * editor/fullscreen mount, blocked or not, right after `initialize()`. This
 * makes the #302 fail-open leak (an over-limit space slipping through because
 * the macro-count read failed / under-returned, so `gate_fired=false` with a
 * `macro_count_source` of 'undefined'/'zero'/stale 'kv') directly measurable
 * instead of inferred from the absence of a paywall event. Lite-only: Full and
 * Diagramly never gate, so emitting there would be pure noise.
 */
function trackGateEvaluated(
  customerSuccess: CustomerSuccess,
  actionType: PaywallActionType,
  gateFired: boolean,
): void {
  if (!globals.apWrapper.isLite()) return;
  trackUpgradeEvent(UpgradeEventName.PAYWALL_GATE_EVALUATED, {
    ...getUpgradeContext(),
    surface: actionType === 'fullscreen_viewer' ? 'viewer' : 'editor',
    action_type: actionType,
    gate_fired: gateFired,
    macro_count: customerSuccess.macrosCreated.value,
    macro_count_source: customerSuccess.macroCountSource.value,
    css_enabled: customerSuccess.cssEnabled.value,
    paywall_policy_source: customerSuccess.paywallPolicySource.value,
    space_paid: customerSuccess.spacePaid.value,
    space_paid_scope: customerSuccess.spacePaidSource.value,
    is_lite: true,
  });
}

async function resolveSpaceKey(logTag: string): Promise<string> {
  try {
    return (await globals.apWrapper.getCurrentSpace())?.key || '';
  } catch (e) {
    console.debug(`Could not resolve current space for ${logTag} paywall gate`, e);
    return '';
  }
}

/**
 * Mount `content` underneath PaywallGate with the standard upgrade props.
 * Caller is responsible for firing the upstream tracking events (PAYWALL_*)
 * since their event names / ui_components differ per surface.
 */
export type PaywallActionType = 'page_editor' | 'page_editor_create' | 'fullscreen_viewer';

export async function mountUnderPaywallGate(opts: {
  doc: Diagram;
  content: Component;
  contentProps?: Record<string, unknown>;
  macroKind: MacroKind;
  customerSuccess: CustomerSuccess;
  logTag: string;
  actionType: PaywallActionType;
}): Promise<void> {
  const spaceKey = await resolveSpaceKey(opts.logTag);
  mountRoot(opts.doc, PaywallGate, {
    content: opts.content,
    contentProps: opts.contentProps ?? {},
    macrosCreated: opts.customerSuccess.macrosCreated.value,
    macrosLimit: MACROS_LIMIT,
    upgradeUrl: opts.customerSuccess.upgradeUrl.value,
    enterpriseBundleUrl: opts.customerSuccess.enterpriseBundleUrl.value,
    macroKind: opts.macroKind,
    spaceKey,
    actionType: opts.actionType,
    continueAttemptsIdentity: {
      clientDomain: getClientDomain() || 'unknown_atlassian_domain',
      spaceKey: spaceKey || opts.customerSuccess.spaceKey.value || 'unknown_space',
      userAccountId: forgeGlobal.forgeContext?.accountId || 'unknown_user_account_id',
    },
    onClose: async () => {
      await (await getView()).close();
    },
  });
}

/**
 * High-level gate for the fullscreen viewer surface. Combines the runtime
 * checks (fullscreen + not-editor + saturated Lite space), fires the
 * PAYWALL_TRIGGERED event, and mounts the viewer under PaywallGate.
 *
 * Returns `true` when the gate fired (caller should early-return), `false`
 * otherwise.
 */
export async function tryFullscreenViewerPaywall(opts: {
  doc: Diagram | undefined;
  content: Component;
  contentProps?: Record<string, unknown>;
  macroKind: MacroKind;
}): Promise<boolean> {
  const isFullscreen = await isFullscreenMode();
  const isEditor = await isEditorMode();
  if (!isFullscreen || isEditor) return false;

  const customerSuccess = useCustomerSuccessService();
  // No variant gate here on purpose: this runs on every fullscreen-viewer
  // mount regardless of product_type. initialize() itself no-ops the
  // Lite-only bits internally (persistTargetingMarker checks isLite()); the
  // paywall block below is separately Lite-scoped via shouldBlockActions.
  await customerSuccess.initialize();
  const viewerBlocked = isFullscreenViewerBlocked(
    isFullscreen,
    isEditor,
    customerSuccess.shouldBlockActions.value,
  );
  trackGateEvaluated(customerSuccess, 'fullscreen_viewer', viewerBlocked);
  if (!viewerBlocked) {
    return false;
  }

  trackUpgradeEvent(UpgradeEventName.PAYWALL_TRIGGERED, {
    ui_component: UIComponent.MODAL,
    action_type: 'fullscreen_viewer',
    ...getUpgradeContext(),
  });

  await mountUnderPaywallGate({
    doc: opts.doc ?? NULL_DIAGRAM,
    content: opts.content,
    contentProps: opts.contentProps,
    macroKind: opts.macroKind,
    customerSuccess,
    logTag: 'fullscreen-viewer',
    actionType: 'fullscreen_viewer',
  });
  return true;
}

/**
 * High-level gate for the page-editor surface (edit + create). Initializes
 * customer success, checks both block predicates, fires PAYWALL_BLOCKED_*
 * + PAYWALL_TRIGGERED, and mounts the editor under PaywallGate.
 *
 * Returns `true` when the gate fired (caller should early-return).
 */
export async function tryPageEditorPaywall(opts: {
  doc: Diagram;
  content: Component;
  contentProps?: Record<string, unknown>;
  macroKind: MacroKind;
  customContentId?: string;
}): Promise<boolean> {
  const customerSuccess = useCustomerSuccessService();
  // No variant gate here either — same reasoning as tryFullscreenViewerPaywall
  // above: initialize() runs unconditionally, Lite-only behaviour lives
  // inside it (persistTargetingMarker) and in shouldBlockActions below.
  await customerSuccess.initialize();
  const editBlocked = !!opts.customContentId && isPageEditorEditBlocked(
    opts.customContentId,
    customerSuccess.shouldBlockActions.value,
  );
  const createBlocked = !opts.customContentId && isPageEditorCreateBlocked(
    customerSuccess.shouldBlockActions.value,
  );

  // customContentId present ⟺ an edit attempt (editBlocked when gated); absent ⟺
  // create. Matches the blocked-branch actionType below, but computed here so the
  // gate-evaluated event tags the not-fired (fail-open) case too.
  const actionType: PaywallActionType = opts.customContentId ? 'page_editor' : 'page_editor_create';
  trackGateEvaluated(customerSuccess, actionType, editBlocked || createBlocked);

  if (!editBlocked && !createBlocked) return false;

  const blockedEvent = editBlocked
    ? UpgradeEventName.PAYWALL_BLOCKED_EDIT
    : UpgradeEventName.PAYWALL_BLOCKED_CREATE;

  trackUpgradeEvent(blockedEvent, {
    ui_component: UIComponent.VIEWER_NOTICE,
    action_type: actionType,
    ...getUpgradeContext(),
  });
  trackUpgradeEvent(UpgradeEventName.PAYWALL_TRIGGERED, {
    ui_component: UIComponent.VIEWER_NOTICE,
    action_type: actionType,
    ...getUpgradeContext(),
  });

  await mountUnderPaywallGate({
    doc: opts.doc,
    content: opts.content,
    contentProps: opts.contentProps,
    macroKind: opts.macroKind,
    customerSuccess,
    logTag: editBlocked ? 'page-editor' : 'page-editor-create',
    actionType,
  });
  return true;
}
