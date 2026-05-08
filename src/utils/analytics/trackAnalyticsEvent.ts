// src/utils/analytics/trackAnalyticsEvent.ts

import mixpanel from "mixpanel-browser";
import {
  getClientDomain,
  getSpaceKey,
} from "@/utils/ContextParameters/ContextParameters";
import forgeGlobal from "@/model/globals/forgeGlobal";
import type { AnalyticsEventName } from "./catalog";
import type { AnalyticsProperties } from "./types";

let _initialized = false;
let _identified = false;

function _initMixpanel() {
  if (!_initialized) {
    const cloudId = forgeGlobal.forgeContext?.cloudId ?? "";
    const isFullReplayClient = cloudId === "d1b3810b-db2f-4f83-8ec3-90f60944e570";

    mixpanel.init(import.meta.env.VITE_MIXPANEL_TOKEN, {
      debug: true,
      track_pageview: false,
      autocapture: false,
      persistence: "localStorage",
      ignore_dnt: true,
      record_sessions_percent: isFullReplayClient ? 100 : 10,
    });
    _initialized = true;
  }
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

export async function _awaitableTrackAnalyticsEvent(
  eventName: AnalyticsEventName,
  callerProps: AnalyticsProperties
): Promise<void> {
  try {
    _initMixpanel();
    _identify();

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
