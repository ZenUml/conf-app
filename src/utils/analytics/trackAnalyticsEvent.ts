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
import { normalizeProductType } from "./productType";
import { isOctoberReplayBudgetActive } from "./octoberReplayBudget";
import { resolveEffectiveCustomContentId } from "@/utils/effectiveCustomContentId";

// Singleton init promise: the first tracked event per iframe resolves the
// session-replay flag (one Forge bridge round-trip) and inits Mixpanel;
// concurrent early events all await the same promise instead of racing into a
// second init.
let _initPromise: Promise<void> | null = null;
let _identified = false;

type ExplicitReplayProperties = Pick<
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

// Upper bound on how long the FIRST event of an iframe waits for the Forge
// feature-flag download (getSessionReplayConfig -> FeatureFlags.initialize, a
// bare bridge postMessage round trip that @forge/bridge never times out). That
// flag only chooses the replay sampling rate, so a late answer must never cost
// the iframe its events (#707: a hung call left the memoised init promise
// pending forever, so mixpanel.init never ran and every event was dropped
// silently). 3s sits well above the normal bridge round trip (tens to a few
// hundred ms) so ordinary iframes keep their flag-driven replay, and well below
// the point where an iframe is likely to be torn down.
export const SESSION_REPLAY_CONFIG_TIMEOUT_MS = 3000;
const SESSION_REPLAY_CONFIG_TIMED_OUT = Symbol("session_replay_config_timed_out");
const REPLAY_OFF = { percent: 0, source: "off" as const };
// Distinct from REPLAY_OFF so session_replay_source separates "the flag said
// off" from "the flag wait was cut short" (#707).
const REPLAY_TIMEOUT = { percent: 0, source: "timeout" as const };

// Resolve the replay config with a bounded wait. Never rejects and never
// hangs: a throw falls back to replay off (source 'off') and a timeout to replay off
// with source 'timeout', and the timer is
// cleared on every path. If the real answer arrives after the timeout it is
// ignored (no re-init), so replay for that iframe stays off.
async function _resolveSessionReplayConfig(): Promise<{
  config: Awaited<ReturnType<typeof getSessionReplayConfig>>;
  timedOut: boolean;
}> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const config = await Promise.race([
      getSessionReplayConfig(),
      new Promise<typeof SESSION_REPLAY_CONFIG_TIMED_OUT>((resolve) => {
        timeout = setTimeout(
          () => resolve(SESSION_REPLAY_CONFIG_TIMED_OUT),
          SESSION_REPLAY_CONFIG_TIMEOUT_MS,
        );
      }),
    ]);
    if (config === SESSION_REPLAY_CONFIG_TIMED_OUT) {
      return { config: REPLAY_TIMEOUT, timedOut: true };
    }
    return { config, timedOut: false };
  } catch (error) {
    console.debug("[session-replay] off: config lookup threw", error);
    return { config: REPLAY_OFF, timedOut: false };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// Share of authoring sessions that record. Authoring replay used to be forced
// on every create/edit; measured over the 30 days to 2026-09-07 that was 13,905
// of 17,743 distinct replays — 78% of a 20,000/month quota consumed by one
// policy, which exhausted the quota before month end and left the last week of
// each month with no recordings at all.
//
// The rate is derived, not picked: the flag-driven viewer baseline is ~3,838
// replays/month and the fullscreen surface adds ~4,108, so ~7,946 are spoken
// for. Half of authoring (~6,950) brings the month to ~14,900 — about 500/day
// against a 667/day ceiling, leaving a quarter of the quota as headroom for
// growth and for targeted inspections.
//
// Not a Forge flag: Lite is at its 10-flag cap, and the cohort system buckets
// by install/account rather than by session, which is the wrong axis for this.
// Re-derive from the same two numbers if the quota or the fullscreen volume
// changes.
const AUTHORING_REPLAY_RATE = 0.5;
const OCTOBER_AUTHORING_REPLAY_RATE = 0.01;

// Draw once per iframe, not per event. Eligibility is stable while the same
// rate applies. At the UTC budget boundary, compare the saved draw with the
// new rate; this can change whether a later authoring event requests a start.
// We never stop an already-running recording at that boundary.
let _authoringReplayDraw: number | null = null;

function _shouldRecordAuthoring(): boolean {
  if (_authoringReplayDraw === null) {
    _authoringReplayDraw = Math.random();
  }
  return _authoringReplayDraw < (isOctoberReplayBudgetActive()
    ? OCTOBER_AUTHORING_REPLAY_RATE
    : AUTHORING_REPLAY_RATE);
}

function _startExplicitReplay(
  eventName: AnalyticsEventName
): Partial<ExplicitReplayProperties> {
  if (eventName === "feedback_report_opened") {
    try {
      mixpanel.start_session_recording();
      const replayProperties: ExplicitReplayProperties = {
        session_replay_source: "feedback",
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
        "[session-replay] feedback start call threw",
        error instanceof Error ? error.name : "unknown"
      );
      return { session_replay_start_call_outcome: "threw" };
    }
  }

  if (
    eventName !== "macro_create_started" &&
    eventName !== "macro_edit_started"
  ) {
    return {};
  }

  // Outside the sample: leave the Forge-flag cohort's decision untouched. Not
  // re-registering matters as much as not starting — stamping `authoring` here
  // would misattribute a flag-driven recording to this policy and corrupt the
  // measurement the rate is tuned from.
  if (!_shouldRecordAuthoring()) {
    return { session_replay_start_call_outcome: "skipped_sampled" };
  }

  try {
    // Authoring replay is an explicit product policy, independent of the
    // baseline Forge-flag cohort resolved by _initMixpanel. The SDK call is
    // idempotent when baseline sampling already started a recording.
    mixpanel.start_session_recording();
    const replayProperties: ExplicitReplayProperties = {
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
      // the flag fetch entirely. During the October 2026 UTC budget window,
      // every iframe's automatic baseline is off before any override or Forge
      // flag is considered. Outside that window, other iframe rates come from
      // the overrides below or the Forge Developer Console.
      //
      // The Plan-and-usage page is the opposite override: it's a brand-new,
      // low-traffic funnel (paywall banner -> usage -> Request Full) we want
      // fully observed while it's new, and per-page targeting isn't something
      // the Forge-flag cohort system supports (it buckets by install/account,
      // not by moduleKey) — so this is hardcoded here rather than attempted as
      // a flag. Revisit (drop back to the flag-driven rate) once the funnel has
      // enough real traffic that 100% capture stops being worth the review cost.
      //
      // The fullscreen modal is the third override, and the only one that is
      // not a moduleKey: it loads the same macro resource as the inline
      // viewer, and is told apart by the modal context forgeIndex.ts passes to
      // openModal. It records at 100% because it is the deliberate-intent
      // viewer surface — a user who opened fullscreen is working on ONE
      // diagram, so the session is worth watching end to end, where an inline
      // render is usually incidental to reading a page. Like the plan-usage
      // page, per-surface targeting is not something the Forge-flag cohort
      // system can express (it buckets by install/account), so this is
      // hardcoded rather than attempted as a flag.
      //
      // Cost, measured 2026-09-07: ~4.1k fullscreen opens/month across all
      // variants (3.4k of them Lite), against ~17.7k distinct replays in the
      // trailing 30 days — roughly a 23% increase in recorded sessions.
      // Revisit if the replay quota becomes the binding constraint.
      const forgeContext = forgeGlobal.forgeContext as any;
      const moduleKey = forgeContext?.moduleKey;
      const isPageBanner = moduleKey === "zenuml-page-banner";
      const isPlanUsagePage = moduleKey === "zenuml-plan-usage-page";
      const isFullscreen =
        forgeContext?.extension?.modal?.macroMode === "fullscreen";
      let replayConfigTimedOut = false;
      // NOTE (#707): this short-circuit runs before _resolveSessionReplayConfig,
      // so the bounded flag wait below is inactive while the October budget
      // branch is taken and becomes live on 2026-11-01 UTC.
      const { percent, source } = isOctoberReplayBudgetActive()
        ? { percent: 0, source: "off" as const }
        : isPageBanner
        ? { percent: 0, source: "off" as const }
        : isPlanUsagePage
        ? { percent: 100, source: "plan_usage_page" as const }
        : isFullscreen
        ? { percent: 100, source: "fullscreen" as const }
        : await _resolveSessionReplayConfig().then((resolved) => {
            replayConfigTimedOut = resolved.timedOut;
            return resolved.config;
          });

      mixpanel.init(import.meta.env.VITE_MIXPANEL_TOKEN, {
        debug: true,
        track_pageview: false,
        autocapture: false,
        persistence: "localStorage",
        ignore_dnt: true,
        record_sessions_percent: percent,
        // Replay console + network telemetry. Console is the SDK default (kept
        // explicit; see docs/superpowers/specs/2026-08-21-authoring-session-replay-design.md
        // for the accepted trade-off). Network capture needs mixpanel-browser
        // >= 2.76 (added 2026-03-18; this repo was on 2.73 until 2026-09-11), so
        // replays recorded before that upgrade have an empty Network tab. The
        // plugin defaults record URL, method, status and timing only — no
        // headers, no bodies — so diagram content never enters the recording.
        record_console: true,
        record_network: true,
      });
      // Stamp every event with the resolved rate + why, so the throttle and
      // targeting can be confirmed live in Mixpanel.
      mixpanel.register({
        session_replay_percent: percent,
        session_replay_source: source,
      });
      if (replayConfigTimedOut) {
        // Fired after init so it actually leaves; not awaited because it
        // awaits this very promise.
        void _awaitableTrackAnalyticsEvent("analytics_init_degraded", {
          feature_area: "system",
          surface: "iframe_bootstrap",
          module_key: moduleKey,
          reason: "session_replay_config_timeout",
          timeout_ms: SESSION_REPLAY_CONFIG_TIMEOUT_MS,
        });
      }
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
  // The id the viewer actually loaded: config, then modal, then a pasted typed
  // deeplink. A macro placed by autoConvert has no config, so reading config and
  // modal alone left every event from it (macro_viewed included) with an empty
  // custom_content_id although the diagram rendered (#561).
  const customContentId =
    resolveEffectiveCustomContentId(forgeGlobal.forgeContext) ?? null;
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
    const explicitReplayProperties = _startExplicitReplay(eventName);

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
      product_type: callerProps.product_type ?? normalizeProductType(import.meta.env.PRODUCT_TYPE),
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
      ...explicitReplayProperties,
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
  _authoringReplayDraw = null;
}
