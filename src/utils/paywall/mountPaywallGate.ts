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
  getContext,
  isFullscreenMode,
  isEditorMode,
} from '@/model/globals/forgeGlobal';
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters';
import {
  trackUpgradeEvent,
  UpgradeEventName,
  UIComponent,
} from '@/utils/upgradeTracking';
import type { Surface } from '@/utils/analytics/catalog';
import { isBylineModal } from '@/utils/paywall/modalOrigin';
import {
  isFullscreenViewerBlocked,
  isPageEditorEditBlocked,
  isPageEditorCreateBlocked,
} from '@/utils/paywall/preEditGate';

type CustomerSuccess = ReturnType<typeof useCustomerSuccessService>;

/**
 * The surface a gate decision was made on.
 *
 * `byline_create` is a create exactly like `page_editor_create` — same block
 * predicate, same modal, same counter — but it must be countable separately.
 * The Lite byline exists to be measured (does an entry point on every page turn
 * readers into authors?), and a byline create that dies at the paywall is a
 * completely different outcome from one that succeeds. Folding it into
 * `page_editor_create` makes that funnel unreadable, because the insert-menu
 * create dwarfs it.
 */
export type PaywallActionType =
  | 'page_editor'
  | 'page_editor_create'
  | 'byline_create'
  | 'fullscreen_viewer';

/**
 * The `surface` property that pairs with an action type. Kept beside the union
 * so a new action type cannot silently inherit `editor` — the byline is its own
 * surface in the analytics catalog and has to report as one.
 */
export function surfaceForActionType(actionType: PaywallActionType): Surface {
  if (actionType === 'fullscreen_viewer') return 'viewer';
  if (actionType === 'byline_create') return 'byline';
  return 'editor';
}

/**
 * Which create surface this editor was opened from.
 *
 * The byline opens the ordinary editor via `openModal({ macroMode: 'editor' })`,
 * so it arrives here indistinguishable from an insert-menu create unless it says
 * so. Resolved from the modal context rather than threaded through every call
 * site, because all three editor entry points (forgeIndex for the sequence
 * family, forge-graph-editor, forge-swagger-editor) reach this function and none
 * of them otherwise knows or cares where the modal came from.
 *
 * Note this changes the LABEL only. A byline create takes the same block
 * predicate as any other create — being reachable from a new surface has never
 * been a reason to let it past the limit.
 */
async function resolveCreateActionType(): Promise<PaywallActionType> {
  try {
    return isBylineModal(await getContext()) ? 'byline_create' : 'page_editor_create';
  } catch (e) {
    // Never let a context read decide whether the gate runs — only how it is
    // labelled. Fall back to the pre-existing label.
    console.debug('Could not resolve modal origin for the paywall gate', e);
    return 'page_editor_create';
  }
}

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
    surface: surfaceForActionType(actionType),
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
  // gate-evaluated event tags the not-fired (fail-open) case too. A create is
  // split further by which surface opened the editor — see resolveCreateActionType.
  const actionType: PaywallActionType = opts.customContentId
    ? 'page_editor'
    : await resolveCreateActionType();
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
    logTag: editBlocked ? 'page-editor' : actionType.replace(/_/g, '-'),
    actionType,
  });
  return true;
}
