// src/utils/analytics/trackAnalyticsEvent.ts

import mixpanel, { type Mixpanel } from "mixpanel-browser";
import {
  getClientDomain,
  getSpaceKey,
} from "@/utils/ContextParameters/ContextParameters";
import forgeGlobal, { openUrl } from "@/model/globals/forgeGlobal";
import type { AnalyticsEventName } from "./catalog";
import type { AnalyticsProperties } from "./types";
import type { SpaceAdmin } from "@/model/SpaceAdmin";
import { isCurrentPageDemoPage } from "./demoPageStatus";
import {
  getDevelopmentPageReplayConfig,
  getSessionReplayConfig,
} from "./sessionReplayFlags";
import { decideSample } from "./eventSampling";
import { normalizeProductType } from "./productType";

type DevelopmentReplayError = {
  message: string;
  errorName: string | null;
  errorMessage: string | null;
};

// This panel is intentionally available only under the existing development
// page override. Error strings can contain URLs (and their query strings), so
// retain the SDK's diagnostic text while removing URL values and bounding its
// size before rendering it into the Forge iframe.
function _sanitizeDevelopmentReplayDiagnostic(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value
    .replace(/https?:\/\/[^\s)]+/g, "<url>")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 300);
}

// Singleton init promise: the first tracked event per iframe resolves the
// session-replay flag (one Forge bridge round-trip) and inits Mixpanel;
// concurrent early events all await the same promise instead of racing into a
// second init.
let _initPromise: Promise<void> | null = null;
let _identified = false;
let _analyticsMixpanel: Mixpanel = mixpanel;

// A named instance prevents the temporary diagnostic from inheriting the
// legacy primary instance's prior init (which has record_sessions_percent=0).
// Keep this name aligned with the DEV-only persistence name below: Mixpanel
// creates the persistence wrapper from init config, so disable_persistence
// can only remove this diagnostic key rather than the primary key.
const DEVELOPMENT_REPLAY_INSTANCE_NAME = "zenuml_dev_replay_diagnostic";

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

// Drawn once per iframe, not per event. A user who creates one macro and then
// edits another in the same session must get one whole recording or none —
// re-drawing per event would start the recorder partway through a session,
// which is worse than not recording it at all for the save-failure
// investigations this policy exists to serve.
let _authoringReplayDecision: boolean | null = null;

function _shouldRecordAuthoring(): boolean {
  if (_authoringReplayDecision === null) {
    _authoringReplayDecision = Math.random() < AUTHORING_REPLAY_RATE;
  }
  return _authoringReplayDecision;
}

function _startAuthoringReplay(
  eventName: AnalyticsEventName
): Partial<AuthoringReplayProperties> {
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
    _analyticsMixpanel.start_session_recording();
    const replayProperties: AuthoringReplayProperties = {
      session_replay_source: "authoring",
      session_replay_percent: 100,
      session_replay_start_call_outcome: "returned",
    };
    _analyticsMixpanel.register({
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
      const developmentPageConfig = getDevelopmentPageReplayConfig(forgeContext);
      const developmentReplayErrors: DevelopmentReplayError[] = [];
      const { percent, source } = isPageBanner
        ? { percent: 0, source: "off" as const }
        : isPlanUsagePage
        ? { percent: 100, source: "plan_usage_page" as const }
        : isFullscreen
        ? { percent: 100, source: "fullscreen" as const }
        : developmentPageConfig ?? await getSessionReplayConfig();

      const mixpanelConfig = {
        debug: true,
        track_pageview: false,
        autocapture: false,
        persistence: "localStorage",
        ignore_dnt: true,
        record_sessions_percent: percent,
        // The authorized development page's Chromium profile is currently
        // returning IndexedDB `UnknownError: Internal error.` for Mixpanel's
        // replay queue. The SDK's recorder gates its IndexedDB queue and
        // recording registry on this option, while continuing to batch/send
        // the active page in memory. `disable_persistence` clears the SDK's
        // named persistence entry during init, so give this diagnostic a new
        // unique name first. Scope both changes to the existing temporary page
        // override; this does not clear existing Mixpanel browser data.
        ...(developmentPageConfig
          ? { persistence_name: DEVELOPMENT_REPLAY_INSTANCE_NAME }
          : {}),
        disable_persistence: Boolean(developmentPageConfig),
        ...(developmentPageConfig
          ? {
              error_reporter: (message: string, error?: Error) => {
                developmentReplayErrors.push({
                  message:
                    _sanitizeDevelopmentReplayDiagnostic(message) ?? "unknown",
                  errorName: _sanitizeDevelopmentReplayDiagnostic(error?.name),
                  errorMessage: _sanitizeDevelopmentReplayDiagnostic(error?.message),
                });
              },
            }
          : {}),
      };
      // The legacy `trackEvent` helper can initialize Mixpanel's unnamed
      // primary instance first. A later unnamed init reuses that instance and
      // silently retains its default replay rate of 0. The targeted diagnostic
      // uses its own named instance, whose initial config is therefore the
      // source of truth without changing legacy/production behavior.
      _analyticsMixpanel = developmentPageConfig
        ? mixpanel.init(
            import.meta.env.VITE_MIXPANEL_TOKEN,
            mixpanelConfig,
            DEVELOPMENT_REPLAY_INSTANCE_NAME,
          ) || mixpanel
        : (mixpanel.init(import.meta.env.VITE_MIXPANEL_TOKEN, mixpanelConfig), mixpanel);
      // Tunnel-only, target-only diagnostic. The ESM SDK is not guaranteed to
      // expose its default instance as window.mixpanel, so provide a narrowly
      // scoped callable for UI verification without exposing tokens or event
      // payloads. Remove with the temporary override after validation.
      if (developmentPageConfig) {
        (window as any).__zenumlSessionReplayDiagnostics = () => ({
          sessionReplayPercent: percent,
          sessionReplaySource: source,
          recorderLoaded: Boolean(_analyticsMixpanel.__get_recorder?.()),
          recordingActive: Boolean(
            (_analyticsMixpanel.__get_recorder?.() as any)?.activeRecording &&
              !(_analyticsMixpanel.__get_recorder?.() as any).activeRecording.isRrwebStopped(),
          ),
          recorderBatchesSent:
            (_analyticsMixpanel.__get_recorder?.() as any)?.activeRecording?.seqNo ?? null,
          recorderLastEventTimestamp:
            (_analyticsMixpanel.__get_recorder?.() as any)?.activeRecording
              ?.lastEventTimestamp ?? null,
          recorderConstructorType: typeof (window as any).__mp_recorder,
          sdkRecordingPercent: _analyticsMixpanel.get_config("record_sessions_percent"),
          sdkDisablePersistence: _analyticsMixpanel.get_config("disable_persistence"),
          sdkOptedOut: _analyticsMixpanel.has_opted_out_tracking(),
          mutationObserverAvailable: typeof window.MutationObserver === "function",
          recorderErrors: [...developmentReplayErrors],
          ..._analyticsMixpanel.get_session_recording_properties(),
          replayUrl: _analyticsMixpanel.get_session_replay_url() || null,
        });
        _installDevelopmentReplayDiagnostics(percent, source);
      }
      // Stamp every event with the resolved rate + why, so the throttle and
      // targeting can be confirmed live in Mixpanel.
      _analyticsMixpanel.register({
        session_replay_percent: percent,
        session_replay_source: source,
      });
    })();
  }
  return _initPromise;
}

function _installDevelopmentReplayDiagnostics(
  percent: number,
  source: string,
): void {
  const id = "zenuml-dev-replay-diagnostics";
  const panel = document.createElement("details");
  panel.id = id;
  panel.open = true;
  panel.style.cssText =
    "position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:360px;padding:8px 10px;background:#172b4d;color:#fff;border:1px solid #8c9aaa;border-radius:6px;font:12px/1.4 monospace;box-shadow:0 2px 8px #0006";
  const summary = document.createElement("summary");
  summary.textContent = "DEV REPLAY";
  summary.style.cursor = "pointer";
  panel.append(summary);
  const body = document.createElement("div");
  body.style.marginTop = "6px";
  panel.append(body);
  document.body.append(panel);

  const render = () => {
    const diagnostics = (window as any).__zenumlSessionReplayDiagnostics?.() ?? {};
    body.replaceChildren();
    const policy = document.createElement("div");
    policy.textContent = `policy: ${percent}% (${source})`;
    body.append(policy);
    const replayId = diagnostics.$mp_replay_id;
    const replayUrl = diagnostics.replayUrl;
    if (!replayId) {
      const pending = document.createElement("div");
      pending.textContent = diagnostics.recorderLoaded
        ? `recorder: ${diagnostics.recordingActive ? "active" : "stopped"}; replay pending`
        : "recorder: not loaded (100% policy is not upload proof)";
      body.append(pending);
      const sdkState = document.createElement("div");
      sdkState.textContent = `SDK: recorder constructor=${diagnostics.recorderConstructorType}; percent=${diagnostics.sdkRecordingPercent}; opt-out=${diagnostics.sdkOptedOut}; persistence disabled=${diagnostics.sdkDisablePersistence}; MutationObserver=${diagnostics.mutationObserverAvailable}`;
      body.append(sdkState);
      if (diagnostics.recorderErrors?.length) {
        const errors = document.createElement("div");
        errors.textContent = `recorder errors: ${diagnostics.recorderErrors
          .map(
            (error: DevelopmentReplayError) =>
              `${error.message}${error.errorName ? ` (${error.errorName}${error.errorMessage ? `: ${error.errorMessage}` : ""})` : ""}`,
          )
          .join("; ")}`;
        body.append(errors);
      }
      return Boolean(replayUrl);
    }
    const idLine = document.createElement("div");
    idLine.textContent = `replay id: ${replayId}`;
    body.append(idLine);
    const batchLine = document.createElement("div");
    batchLine.textContent = `successful batches: ${diagnostics.recorderBatchesSent ?? 0}`;
    body.append(batchLine);
    if (replayUrl) {
      const link = document.createElement("a");
      link.href = replayUrl;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void openUrl(replayUrl);
      });
      link.textContent = "Open Mixpanel replay";
      link.style.color = "#b3d4ff";
      body.append(link);
    }
    return true;
  };

  render();
  panel.addEventListener("toggle", () => {
    if (panel.open) render();
  });
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    // The temporary panel can outlive a jsdom test environment. Stop the
    // polling callback cleanly once its window has been torn down.
    if (typeof window === "undefined") {
      clearInterval(timer);
      return;
    }
    const ready = render();
    if (ready || Date.now() - startedAt >= 30_000) {
      clearInterval(timer);
    }
  }, 500);
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
    _analyticsMixpanel.identify(id);
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
      ...authoringReplayProperties,
    };

    if (options) {
      _analyticsMixpanel.track(eventName, enriched, options);
    } else {
      _analyticsMixpanel.track(eventName, enriched);
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
  _authoringReplayDecision = null;
  _analyticsMixpanel = mixpanel;
}
