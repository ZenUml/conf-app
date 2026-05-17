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
  getView,
  isFullscreenMode,
  isEditorMode,
} from '@/model/globals/forgeGlobal';
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
  await customerSuccess.initialize();
  if (!isFullscreenViewerBlocked(isFullscreen, isEditor, customerSuccess.shouldBlockActions.value)) {
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
  await customerSuccess.initialize();
  const editBlocked = !!opts.customContentId && isPageEditorEditBlocked(
    opts.customContentId,
    customerSuccess.shouldBlockActions.value,
  );
  const createBlocked = !opts.customContentId && isPageEditorCreateBlocked(
    customerSuccess.shouldBlockActions.value,
  );
  if (!editBlocked && !createBlocked) return false;

  const actionType = editBlocked ? 'page_editor' : 'page_editor_create';
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
  });
  return true;
}
