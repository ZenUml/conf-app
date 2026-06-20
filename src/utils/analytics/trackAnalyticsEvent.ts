// src/utils/analytics/trackAnalyticsEvent.ts

import mixpanel from "mixpanel-browser";
import {
  getClientDomain,
  getSpaceKey,
} from "@/utils/ContextParameters/ContextParameters";
import forgeGlobal from "@/model/globals/forgeGlobal";
import type { AnalyticsEventName } from "./catalog";
import type { AnalyticsProperties } from "./types";
import type { SpaceAdmin } from "@/model/SpaceAdmin";
import { isCurrentPageDemoPage } from "./demoPageStatus";

let _initialized = false;
let _identified = false;

function _initMixpanel() {
  if (import.meta.env.MODE !== "test" && import.meta.env.VITE_MIXPANEL_TOKEN === "") {
    return false;
  }
  if (!_initialized) {
    const cloudId = forgeGlobal.forgeContext?.cloudId ?? "";
    const isHighReplayClient = cloudId === "d1b3810b-db2f-4f83-8ec3-90f60944e570";

    mixpanel.init(import.meta.env.VITE_MIXPANEL_TOKEN, {
      debug: true,
      track_pageview: false,
      autocapture: false,
      persistence: "localStorage",
      ignore_dnt: true,
      record_sessions_percent: isHighReplayClient ? 20 : 4,
    });
    _initialized = true;
  }
  return true;
}

function _getCurrentUserAccountId(): string {
  return (
    // @ts-ignore — globals set by Forge bridge at runtime
    window.globals?.apWrapper?.currentUser?.atlassianAccountId ||
    "unknown_user_account_id"
  );
}

async function _getMacroUuid(): Promise<string> {
  if (forgeGlobal.isForge && forgeGlobal.forgeContext?.localId) {
    return forgeGlobal.forgeContext.localId;
  }
  try {
    // @ts-ignore
    const macroData = await window.globals?.apWrapper?.getMacroData();
    return macroData?.uuid || "unknown_macro_uuid";
  } catch {
    return "unknown_macro_uuid";
  }
}

function _getProductType(): "lite" | "full" | "diagramly" {
  const t = import.meta.env.PRODUCT_TYPE;
  if (t === "lite" || t === "full" || t === "diagramly") return t;
  return "full";
}

function _identify() {
  if (!_identified) {
    const id = _getCurrentUserAccountId();
    try {
      mixpanel.identify(id);
      _identified = id !== "unknown_user_account_id";
    } catch (e) {
      console.error("mixpanel.identify error", e);
    }
  }
}

async function _getSpaceAdminTelemetry(
  eventName: AnalyticsEventName
): Promise<Pick<AnalyticsProperties, "space_admin_count">> {
  if (eventName !== "macro_viewed") {
    return {};
  }

  try {
    // @ts-ignore — globals set by Forge bridge at runtime
    const admins = await window.globals?.apWrapper?.getCurrentSpaceAdmins?.() as
      | SpaceAdmin[]
      | undefined;

    if (!admins) {
      return {};
    }

    console.info("[macro_viewed] space admins", admins);
    return { space_admin_count: admins.length };
  } catch (e) {
    console.warn("[macro_viewed] failed to resolve space admins", e);
    return {};
  }
}

function _getContentIdentifiers(): {
  page_id: string | null;
  custom_content_id: string | null;
  attachment_name: string | null;
} {
  const extension = forgeGlobal.forgeContext?.extension as any;
  const pageId = extension?.content?.id ?? null;
  const customContentId =
    extension?.config?.customContentId ??
    extension?.modal?.customContentId ??
    null;
  const attachmentName = customContentId ? `zenuml-${customContentId}.png` : null;
  return {
    page_id: pageId,
    custom_content_id: customContentId,
    attachment_name: attachmentName,
  };
}

// Enriches macro_* events with `is_demo_page: true` when the current macro
// lives on a Diagramly demo page (tagged via page property on creation).
// The lookup is cached per page id; first call costs one Confluence REST
// hit, subsequent macro views on the same page reuse the cached value.
async function _getDemoPageTelemetry(
  eventName: AnalyticsEventName
): Promise<Pick<AnalyticsProperties, "is_demo_page">> {
  if (!eventName.startsWith("macro_")) {
    return {};
  }
  try {
    const isDemo = await isCurrentPageDemoPage();
    return isDemo ? { is_demo_page: true } : {};
  } catch {
    return {};
  }
}

export async function _awaitableTrackAnalyticsEvent(
  eventName: AnalyticsEventName,
  callerProps: AnalyticsProperties
): Promise<void> {
  try {
    if (!_initMixpanel()) return;
    _identify();

    const contentIds = _getContentIdentifiers();

    const enriched: Record<string, unknown> = {
      ...callerProps,
      user_account_id:
        callerProps.user_account_id ?? _getCurrentUserAccountId(),
      client_domain:
        callerProps.client_domain ??
        getClientDomain() ??
        "unknown_atlassian_domain",
      confluence_space:
        callerProps.confluence_space ?? getSpaceKey() ?? "unknown_space",
      macro_uuid: callerProps.macro_uuid ?? (await _getMacroUuid()),
      product_type: callerProps.product_type ?? _getProductType(),
      environment_type:
        callerProps.environment_type ??
        forgeGlobal.forgeContext?.environmentType ??
        "unknown_environment_type",
      app_version: callerProps.app_version ?? import.meta.env.VITE_APP_VERSION,
      app_commit: callerProps.app_commit ?? import.meta.env.VITE_APP_COMMIT,
      page_id: callerProps.page_id ?? contentIds.page_id,
      content_id: callerProps.content_id ?? contentIds.custom_content_id,
      custom_content_id:
        callerProps.custom_content_id ?? contentIds.custom_content_id,
      attachment_name: callerProps.attachment_name ?? contentIds.attachment_name,
      ...(await _getSpaceAdminTelemetry(eventName)),
      ...(await _getDemoPageTelemetry(eventName)),
    };

    mixpanel.track(eventName, enriched);
  } catch (e) {
    console.error("[analytics] trackAnalyticsEvent failed", e);
  }
}

export function trackAnalyticsEvent(
  eventName: AnalyticsEventName,
  properties: AnalyticsProperties
): void {
  void _awaitableTrackAnalyticsEvent(eventName, properties);
}

export function _resetForTesting(): void {
  _initialized = false;
  _identified = false;
}
