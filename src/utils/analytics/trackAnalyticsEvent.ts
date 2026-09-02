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
import { getSessionReplayConfig } from "./sessionReplayFlags";
import { decideSample } from "./eventSampling";
import { normalizeProductType, type ProductType } from "./productType";

// Singleton init promise: the first tracked event per iframe resolves the
// session-replay flag (one Forge bridge round-trip) and inits Mixpanel;
// concurrent early events all await the same promise instead of racing into a
// second init.
let _initPromise: Promise<void> | null = null;
let _identified = false;

type AuthoringReplayProperties = Pick<
  AnalyticsProperties,
  | "session_replay_source"
  | "session_replay_percent"
  | "session_replay_start_call_outcome"
>;

// `is_demo_page` is useful segmentation, but it is never allowed to hold an
// analytics event hostage. In particular, an editor iframe can be torn down
// soon after it opens; if the optional page-property request stalls, losing
// `macro_*_started` also loses the replay-to-event join for that session.
const DEMO_PAGE_TELEMETRY_TIMEOUT_MS = 750;
const DEMO_PAGE_TELEMETRY_TIMED_OUT = Symbol("demo_page_telemetry_timed_out");

function _startAuthoringReplay(
  eventName: AnalyticsEventName
): Partial<AuthoringReplayProperties> {
  if (
    eventName !== "macro_create_started" &&
    eventName !== "macro_edit_started"
  ) {
    return {};
  }

  try {
    // Authoring replay is an explicit product policy, independent of the
    // baseline Forge-flag cohort resolved by _initMixpanel. The SDK call is
    // idempotent when baseline sampling already started a recording.
    mixpanel.start_session_recording();
    const replayProperties: AuthoringReplayProperties = {
      session_replay_source: "authoring",
      session_replay_percent: 100,
      session_replay_start_call_outcome: "returned",
    };
    mixpanel.register({
      session_replay_percent: replayProperties.session_replay_percent,
      session_replay_source: replayProperties.session_replay_source,
    });
    return replayProperties;
  } catch (error) {
    console.error(
      "[session-replay] authoring start call threw",
      error instanceof Error ? error.name : "unknown"
    );
    return { session_replay_start_call_outcome: "threw" };
  }
}

function _initMixpanel(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      // The page-banner iframe is short-lived and has no macro context — session
      // replay there adds noise without value, so it never records and we skip
      // the flag fetch entirely. Every other iframe's sampling rate is set live
      // from the Forge Developer Console (see sessionReplayFlags.ts) — there is
      // deliberately no hardcoded percentage here.
      const isPageBanner =
        (forgeGlobal.forgeContext as any)?.moduleKey === "zenuml-page-banner";
      const { percent, source } = isPageBanner
        ? { percent: 0, source: "off" as const }
        : await getSessionReplayConfig();

      mixpanel.init(import.meta.env.VITE_MIXPANEL_TOKEN, {
        debug: true,
        track_pageview: false,
        autocapture: false,
        persistence: "localStorage",
        ignore_dnt: true,
        record_sessions_percent: percent,
      });
      // Stamp every event with the resolved rate + why, so the throttle and
      // targeting can be confirmed live in Mixpanel.
      mixpanel.register({
        session_replay_percent: percent,
        session_replay_source: source,
      });
    })();
  }
  return _initPromise;
}

// A single constant shared by EVERY user, returned whenever the Forge context
// has not resolved yet. It must never reach mixpanel.identify() — see _identify.
const UNKNOWN_USER_ACCOUNT_ID = "unknown_user_account_id";

// SWR account-id cache. Same discipline as the cohort marker
// (utils/cohorts/userCohorts.ts): a localStorage marker written by whichever
// iframe has a resolved Forge context and read synchronously by the next one,
// **scoped by clientDomain** so one tenant can never inherit another's id.
//
// Why: the anonymous fallback in _identify only merges an iframe's early events
// AFTER the context resolves. The cache removes the gap entirely — the very
// first event of every subsequent iframe is attributed immediately, with no
// wait and no dependence on Mixpanel's ID-merge mode.
//
// Residual risk, accepted: two Atlassian accounts sharing one browser profile
// on the same site. The stale id would mis-attribute that iframe's first events
// until the real one resolves, at which point the cache is corrected. localStorage
// is per-browser ≈ per-user (the same assumption userCohorts.ts already makes),
// and the alternative — staying anonymous — mis-attributes 100% of first events
// rather than a rare few.
function _accountIdCacheKey(): string {
  return `zenumlAccountId:${getClientDomain() || "unknown"}`;
}

function _readCachedAccountId(): string | undefined {
  try {
    return localStorage.getItem(_accountIdCacheKey()) || undefined;
  } catch {
    return undefined;
  }
}

function _cacheAccountId(id: string): void {
  try {
    if (localStorage.getItem(_accountIdCacheKey()) !== id) {
      localStorage.setItem(_accountIdCacheKey(), id);
    }
  } catch {
    /* private mode / storage disabled — degrade to the anonymous path */
  }
}

function _getCurrentUserAccountId(): string {
  const live =
    // @ts-ignore — globals set by Forge bridge at runtime
    window.globals?.apWrapper?.currentUser?.atlassianAccountId as
      | string
      | undefined;
  if (live) {
    // Write-through: also corrects a stale entry after an account switch.
    _cacheAccountId(live);
    return live;
  }
  return _readCachedAccountId() || UNKNOWN_USER_ACCOUNT_ID;
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

function _getProductType(): ProductType {
  return normalizeProductType(import.meta.env.PRODUCT_TYPE);
}

function _identify() {
  if (_identified) return;
  const id = _getCurrentUserAccountId();
  // Never identify as the placeholder. It is one constant shared by every user,
  // so identifying with it permanently pins the event to a single bogus profile
  // — the events cannot be merged into the real user later, because that id is
  // not an anonymous alias, it is a legitimate distinct_id belonging to no one.
  // Measured 2026-07-26 (30d): the loss is confined to events that fire before
  // the context resolves — ai_aide_route_accessed 100%, renderer_prefetch_*
  // 35-37%, legacy_content_property_load_failed 30% (fleet-wide only 0.06%,
  // because every high-volume event fires after resolution).
  //
  // Returning early leaves the event on Mixpanel's own per-device anonymous
  // distinct_id, which the later identify() merges into the real user. Chosen
  // over waiting for the context: a bounded wait would delay every first event
  // and lose it outright if the iframe unmounts first — a mis-attributed event
  // is bad, a missing one is worse.
  if (id === UNKNOWN_USER_ACCOUNT_ID) return;
  try {
    mixpanel.identify(id);
    _identified = true;
  } catch (e) {
    console.error("mixpanel.identify error", e);
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

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const isDemo = await Promise.race([
      isCurrentPageDemoPage(),
      new Promise<typeof DEMO_PAGE_TELEMETRY_TIMED_OUT>((resolve) => {
        timeout = setTimeout(
          () => resolve(DEMO_PAGE_TELEMETRY_TIMED_OUT),
          DEMO_PAGE_TELEMETRY_TIMEOUT_MS,
        );
      }),
    ]);
    if (isDemo === DEMO_PAGE_TELEMETRY_TIMED_OUT) {
      return {};
    }
    return isDemo ? { is_demo_page: true } : {};
  } catch {
    return {};
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Extra options handed straight to mixpanel.track. Only the transport override
 * is used today — see trackAnalyticsEventBeforeUnload.
 */
interface TrackTransportOptions {
  transport: "sendBeacon";
}

export async function _awaitableTrackAnalyticsEvent(
  eventName: AnalyticsEventName,
  callerProps: AnalyticsProperties,
  options?: TrackTransportOptions
): Promise<void> {
  try {
    // Volume sampling first: a dropped event must not pay the init cost — the
    // first tracked event per iframe otherwise triggers a Forge-bridge round
    // trip (session-replay flag) inside _initMixpanel.
    const sample = decideSample(eventName);
    if (!sample.keep) return;

    await _initMixpanel();
    _identify();
    const authoringReplayProperties = _startAuthoringReplay(eventName);

    const contentIds = _getContentIdentifiers();

    const enriched: Record<string, unknown> = {
      ...callerProps,
      ...(sample.rate < 1 ? { sample_rate: sample.rate } : {}),
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
      ...authoringReplayProperties,
    };

    if (options) {
      mixpanel.track(eventName, enriched, options);
    } else {
      mixpanel.track(eventName, enriched);
    }
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

/**
 * For a caller that navigates away immediately after tracking — the load-failed
 * panel's "Try again" reloads the iframe on the next line. The default XHR
 * transport is aborted by that navigation, so the event never arrives:
 * production recorded 1 `load_failed_retry_resolved` and 0
 * `load_failed_retry_clicked` on 2026-08-23. sendBeacon is queued by the
 * browser and survives unload.
 *
 * Await it: the enrichment itself is async (Mixpanel init, macro uuid, space
 * telemetry), so firing and navigating would lose the event before it ever
 * reaches the transport.
 */
export async function trackAnalyticsEventBeforeUnload(
  eventName: AnalyticsEventName,
  properties: AnalyticsProperties
): Promise<void> {
  await _awaitableTrackAnalyticsEvent(eventName, properties, {
    transport: "sendBeacon",
  });
}

export function _resetForTesting(): void {
  _initPromise = null;
  _identified = false;
}
