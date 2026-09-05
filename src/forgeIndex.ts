import globals from '@/model/globals';
import forgeGlobal, { getView, getContext as initForgeContext, isEditorMode, openModal, isInserting, isConfiguring, isFullscreenMode } from '@/model/globals/forgeGlobal';
import EventBus from './EventBus'
import {trackEvent, serializeError} from "@/utils/window";
import { toast } from '@/utils/toast';
import {Diagram, DiagramType} from "@/model/Diagram/Diagram";
import { decideWriteback, deriveWritebackSignals } from "@/model/writebackGate";
import { decidePublishBlock, PUBLISH_BLOCK_MESSAGES } from "@/model/editDupGate";
import { guardEditClick } from "@/utils/guardEditClick";
import { resolveAsyncApiEditorEntry } from "@/model/asyncapi/resolveEditorEntry";

import './assets/tailwind.css'
import { saveToPlatform } from "./model/ContentProvider/Persistence";
import macroMetrics from "@/services/MacroMetrics";
import store from './model/store2'

import Example from "./utils/sequence/Example";
import { showCloseWithoutSavingDialog } from './utils/modalService';
import { handleGetStartedRoute } from './routes/getStarted';
import { startEditJourney, endEditJourney, getOrCreateSession, getEditJourneyId, getEditJourneyStartTime, continueEditJourney } from '@/utils/journeyTracking';
import uuidv4 from '@/utils/uuid';
import { handleAiAideRoute } from './routes/aiAide';
import { decidePageBanner, handlePageBannerRoute } from './routes/pageBanner';
import { tryFullscreenViewerPaywall, tryPageEditorPaywall } from '@/utils/paywall/mountPaywallGate';
import { maybeProbeSpaceAdmin } from '@/utils/paywall/spaceAdminProbe';
import { maybeSendFirstSeenPing } from '@/utils/firstSeen/firstSeenPing';
import { refreshUserCohortsIfStale } from '@/utils/cohorts/userCohorts';
import { isPrefetchDue } from '@/utils/prefetch/throttle';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { markPublishClicked, trackPublishCompleted } from '@/utils/analytics/publishTiming'
import { notifyAiTitleSaved } from '@/composables/useAutoTitle';
import { handleCreateDemoPageRoute } from './routes/createDemoPage';
import { handleHomepageFeedRoute } from './routes/homepageFeed';
import { type MacroTypeValue } from '@/utils/analytics/catalog';
import { NULL_DIAGRAM, DataSource } from '@/model/Diagram/Diagram';
import { applyViewerLoadOutcome, mapCustomContentLoadError, publishDiagramAttribution, setSequenceViewerLoadState } from '@/utils/viewerLoadOutcome';
import { attributionFromCustomContent, type DiagramAttribution } from '@/model/DiagramAttribution';
import type { DiagramLoadError } from '@/model/store2/types';
import { reportOrphanObserved, reportOrphanMacroRepaired } from '@/utils/orphanTelemetry';
import { isValidCustomContentId } from '@/utils/customContentId';
import { isSequenceFamilyEntry } from '@/utils/macroEntryRouting';
import {
  reportLegacyContentPropertyRestored,
  reportLegacyContentPropertyLoadFailed,
  reportLegacyContentPropertyValueUnexpected,
  reportLegacyContentPropertyMacroRepaired,
} from '@/utils/legacyContentPropertyTelemetry';
import { LegacyLoadBlockedSaveError, InvalidSavedContentIdError } from '@/model/ContentProvider/Persistence';
import * as renderPerf from '@/utils/analytics/renderPerf';
import { getCachedContent, putCachedContent, hashContent } from '@/utils/renderCache/contentCacheStore';
import { applyNewDiagramLink, applyRequestedDiagramType, diagramTypeFromModalType, readAutoConvertLink } from '@/utils/newDiagramLink';
import { maybeGateViewerRender, awaitGateBlocking, getGateMode } from '@/utils/renderGate/maybeGateViewerRender';
import { trackEditorMutationLifecycleEvent } from '@/utils/analytics/editorMutationTelemetry';

// Track editor session start time
const editorStartTime = Date.now();

// Captured at editor open from extension.config.uuid; the 'save' EventBus
// handler reads it back to forward through view.submit's replace-semantics
// so Connect-era guestParams.uuid survives.
let originalConfigUuid: string | undefined;

// ZEN-1170 Defect 2b: captured during load so the save handler can detect
// when the persisted id differs from the macro's stale config id and repair
// the macro XML via view.submit({config:...}).
let originalCustomContentId: string | undefined;
let recoveryPageId: string | undefined;

// Initialize critical path rendering first
async function initializeCriticalPath() {
  // Phase 0b: first line of app code — records bootstrap_ms (head scripts incl.
  // DrawIO + entry bundle eval, everything between __macroLoadStart and here).
  renderPerf.markAppEntry();

  await initForgeContext();

  // Modals opened from a globalPage / spacePage keep the parent's
  // extension.type but populate extension.modal with the openModal
  // context. For asyncapi modals opened from the dashboard, we want
  // dispatch to fall through to loadHeavyComponents (which routes on
  // modal.diagramType + modal.macroMode) — not to re-render the dashboard
  // inside the modal. Detect via modal.macroMode which the openModal
  // caller sets to 'editor' / 'viewer' / 'fullscreen'; Forge's default
  // extension.modal (when there isn't a real modal) doesn't have it.
  const context = await initForgeContext();
  const isOpenedModal = !!context.extension?.modal?.macroMode;

  // Check if this is a global settings route (get started page)
  if (!isOpenedModal && context.extension?.type === 'confluence:globalSettings') {
    if (context.moduleKey === 'diagramly-admin-create-demo-page') {
      await handleCreateDemoPageRoute();
    } else {
      await handleGetStartedRoute();
    }
    return { macroData: null };
  }

  // Check if this is a global page route (dashboard). The ZenUML variants
  // route this to the existing getStarted UI.
  if (!isOpenedModal && context.extension?.type === 'confluence:globalPage') {
    await handleGetStartedRoute();
    return { macroData: null };
  }

  // Check if this is a space page route. The asyncapi variant ships a
  // confluence:spacePage entry (zenuml-asyncapi-dashboard-page) that
  // renders "My API Documents" in each Confluence space's sidebar —
  // mirrors the original AsyncAPI-Conf-V2 spacePage. The route is gated
  // on PRODUCT_TYPE so Vite dead-code-eliminates the import in
  // non-asyncapi variant builds.
  if (
    !isOpenedModal &&
    context.extension?.type === 'confluence:spacePage' &&
    import.meta.env.PRODUCT_TYPE === 'asyncapi'
  ) {
    const { handleAsyncApiDashboardRoute } = await import('./routes/asyncApiDashboard');
    await handleAsyncApiDashboardRoute();
    return { macroData: null };
  }

  // Home page feed card (confluence:homepageFeed). No moduleKey
  // discrimination needed — lite/full/diagramly ship exactly one entry
  // (zenuml-homepage-feed); asyncapi strips the whole module (see
  // manifest.yml + scripts/forge-wizard.mjs), so this branch never runs
  // there. No `route` property exists for this module type (Forge manifest
  // reference), so extension.type is the only signal available.
  if (!isOpenedModal && context.extension?.type === 'confluence:homepageFeed') {
    await handleHomepageFeedRoute();
    return { macroData: null };
  }

  // Content byline items. THREE entries now share this extension type and
  // every variant ships a different subset (see scripts/forge-wizard.mjs), so
  // discriminate by moduleKey — same pattern as the pageBanner route below.
  // Branching on moduleKey rather than PRODUCT_TYPE means a manifest/route
  // mismatch fails visibly here instead of silently rendering another
  // entry's UI.
  //
  //   zenuml-byline-newuser  → the activation nudge ("View as diagram")
  //   zenuml-byline-diagrams → the Lite diagram index
  //   zenuml-byline-aiaide   → the Aide chat (the fallback)
  if (!isOpenedModal && context.extension?.type === 'confluence:contentBylineItem') {
    if (context.moduleKey === 'zenuml-byline-newuser') {
      const { handleBylineActivationRoute } = await import('./routes/bylineActivation');
      await handleBylineActivationRoute();
    } else if (context.moduleKey === 'zenuml-byline-diagrams') {
      const { handleBylineRoute } = await import('./routes/byline');
      await handleBylineRoute();
    } else {
      await handleAiAideRoute();
    }
    return { macroData: null };
  }

  // Page banner host. A single confluence:pageBanner module mounts on EVERY
  // Confluence page load and decides — synchronously, from localStorage only —
  // which banner (if any) to show: paywall warning outranks the CSAT survey.
  // The paywall branch is eligible only when the space is unpaid, over the
  // Lite hard limit, CSS targeting is on, recent macro authoring activity is
  // present, and the user is not snoozed. On the ~99% of loads where neither
  // banner is eligible we close immediately WITHOUT importing the banner
  // route, initializing the macro context, or mounting Vue. One module +
  // central priority means the banners never coordinate across iframes (no
  // defer). decidePageBanner() touches only the cheap predicates, so this
  // stays a true fast-exit.
  // (Routed by moduleKey, not extension.type, because the pageBanner extension
  // carries no macro config to discriminate on.)
  // The unplaced-diagram banner. A SEPARATE pageBanner module from the host
  // below because Confluence gates it server-side on a content property
  // (`entityPropertyExists`, see manifest.yml): reaching this line at all
  // means the page HAS unplaced diagrams recorded, so there is no cheap
  // local gate to run and nothing to fast-exit. The component verifies the
  // record against the live page and closes itself if it does not hold.
  if ((context as any).moduleKey === 'zenuml-unplaced-banner') {
    await handlePageBannerRoute('unplaced-property');
    return { macroData: null };
  }

  if ((context as any).moduleKey === 'zenuml-page-banner') {
    // Phase 5a measurement: detect whether the current user is a space admin
    // and, when so, fire `space_admin_active`. Runs on EVERY page-banner load
    // (including loads where no banner shows) so we observe admin activity
    // across Confluence, not just on our macros. Lite-only and throttled to
    // once / 30 days per domain:space, so the common load exits synchronously
    // before any init/REST. Awaited before view.close() — closing the iframe
    // would abort the in-flight REST call — and never throws.
    await maybeProbeSpaceAdmin();

    // M1 first-seen ping (onboarding Phase 1): one authenticated POST per
    // browser per tenant per 30 days, resolving the tenant domain for
    // installs where nobody ever opens a macro, and producing the per-account
    // census (P3 denominator). All variants — this is deliberately NOT
    // Lite-gated like the admin probe. Placed before decidePageBanner() so a
    // load that SHOWS a banner still counts toward the census (deviation
    // from the spec's literal "none path" — recorded in deviation-log.md).
    // Awaited for the same reason as the probe: view.close() aborts
    // in-flight requests. Never throws.
    await maybeSendFirstSeenPing();

    const choice = decidePageBanner();
    if (choice === 'none') {
      // Idle renderer prefetch (EAG-64): the banner mounts on every page —
      // including pages with no macros — making it the only surface that can
      // warm the renderer-bundle cache for macro-free browsing. Gated by a
      // cheap synchronous due-check (≤1 attempt per deploy per browser, see
      // utils/prefetch/throttle.ts) so the ~daily-or-rarer due load is the
      // only one that delays view.close() — bounded by the deadline plus a
      // 2s straggler grace (10s worst case).
      // Awaited before view.close() for the same reason as the admin probe:
      // closing the iframe aborts in-flight work. Never throws.
      if (isPrefetchDue()) {
        const { runRendererPrefetchIfDue } = await import('@/utils/prefetch/rendererPrefetch');
        await runRendererPrefetchIfDue({ host: 'banner', deadlineMs: 8_000 });
      }
      const { view } = await import('@forge/bridge');
      view.close();
      return { macroData: null };
    }
    await handlePageBannerRoute(choice);
    return { macroData: null };
  }


  // Initialize context and get macro data (lightweight operations)
  await globals.apWrapper.initializeContext();
  const macroData = await globals.apWrapper.getMacroData();

  // Refresh metrics cache on miss; full collect only on save (Persistence.ts)
  macroMetrics.getMacroMetrics().catch(e => console.error('Error refreshing metrics cache:', e));

  // Return the macro data for use in the second phase
  return { macroData };
}

// Load heavy components asynchronously
async function loadHeavyComponents(criticalData: { macroData: any }) {
  // Dynamically import heavy dependencies
  const [
    { mountRoot }
  ] = await Promise.all([
    import("@/mount-root")
  ]);

  const context = await initForgeContext();

  // Skip loading heavy components for non-macro routes (dashboard /
  // global settings / byline / asyncapi space page / page banner). Their
  // entry handlers (handleGetStartedRoute / handleAiAideRoute /
  // handleAsyncApiDashboardRoute / handlePageBannerRoute) mount their own
  // Vue trees into #app.
  //
  // Exception: modals opened from those routes carry the parent's
  // extension.type but populate extension.modal.macroMode with 'editor' /
  // 'viewer' / 'fullscreen'. We DO want to load heavy components for those
  // modals so the editor / viewer renders — skip only when there's no
  // opened-modal marker (i.e. the actual dashboard / settings page).
  const isOpenedModal = !!context.extension?.modal?.macroMode;
  if (
    (!isOpenedModal &&
      ['confluence:globalSettings', 'confluence:globalPage', 'confluence:contentBylineItem', 'confluence:spacePage', 'confluence:homepageFeed'].includes(context.extension?.type)) ||
    (context as any).moduleKey === 'zenuml-page-banner' ||
    (context as any).moduleKey === 'zenuml-unplaced-banner'
  ) {
    console.log('Skipping heavy components load for global context');
    return;
  }

  // User-cohort targeting refresh. Deliberately variant-agnostic: the KV
  // allow-list is keyed globally by accountId, not by product_type, and
  // "Lite-only" is a constraint each CONSUMER applies later (paywall recall,
  // warning banner) — not something this fetch itself should gate. It must
  // run outside the `isLite()` block below so full/diagramly/asyncapi macro
  // renders also refresh the marker. Fire-and-forget and never awaited on
  // the render path; the module rate-limits itself to one fetch per 24h
  // (see refreshUserCohortsIfStale) so this adds no meaningful cost to
  // every-macro-render placement.
  void refreshUserCohortsIfStale();

  // Paywall page-banner targeting write. Every macro render (viewer OR editor,
  // any diagram type) refreshes the per-space localStorage marker that the
  // global page-banner iframe reads on a LATER page load. This is the ONLY
  // write path: the editor's paywall gate also calls initialize(), but plain
  // viewer page loads never would — and reaching the user BEFORE they open the
  // editor is the whole point of the redesign. Fire-and-forget and Lite-gated
  // (persistTargetingMarker inside initialize() no-ops for Full/Diagramly) so
  // it never blocks or breaks the render. NOTE: this isLite() guard scopes
  // only the paywall-banner write below — it does NOT gate the cohort
  // refresh above, which runs unconditionally (see the comment on it).
  if (globals.apWrapper.isLite()) {
    import('@/composables/useCustomerSuccessService')
      .then(({ useCustomerSuccessService }) => useCustomerSuccessService().initialize())
      .catch(e => console.warn('[paywall-banner] targeting refresh failed', e));
  }

  // Macro-type discriminators. context.moduleKey and the modal diagramType are
  // already available here, so compute them BEFORE the custom-content load.
  // Only the sequence family (sequence/mermaid/plantuml, under the
  // zenuml-sequence-macro module) is rendered by forgeIndex itself; graph,
  // openapi, embed and asyncapi delegate to a dedicated viewer/editor (see the
  // dispatch below) that owns BOTH the custom-content load AND the
  // `customcontent_orphan_observed` telemetry. Loading the doc here for those
  // types was dead work AND fired a SECOND, mislabeled orphan event
  // (diagram_kind pinned to 'sequence'), doubling the orphan dashboards for
  // openapi/graph/embed. The load block below is therefore gated on isSequence.
  // See src/utils/macroEntryRouting.ts.
  const isSequence = isSequenceFamilyEntry(context.moduleKey, context.extension.modal?.diagramType);
  // The `modal?.diagramType` arms exist for modals opened from a NON-macro
  // surface — the Lite byline modal opens a diagram with
  // `moduleKey: 'zenuml-byline-diagrams'`, so every moduleKey test here misses
  // and the routing chain would fall through to the swagger viewer. This
  // mirrors what isSequenceFamilyEntry already does with the same field.
  const isGraph = context.moduleKey.startsWith('zenuml-graph-macro')
    || context.extension.modal?.diagramType === 'graph';
  const isEmbed = context.moduleKey.startsWith('zenuml-embed-macro')
    || context.extension.modal?.diagramType === 'embed';
  // AsyncAPI ships two macros — `zenuml-asyncapi-macro` (page-rendered
  // spec, each instance owns its own custom-content doc) and
  // `zenuml-asyncapi-embed-macro` (references an existing doc by
  // customContentId). The embed editor opens a doc picker; the embed
  // viewer reuses the regular forge-asyncapi-viewer which already
  // reads extension.config.customContentId.
  const isAsyncApiEmbed = context.moduleKey.startsWith('zenuml-asyncapi-embed-macro');
  // isAsyncApi also picks up modal contexts opened from the asyncapi
  // dashboard ("My API Documents"), which don't carry the macro moduleKey
  // but do set extension.modal.diagramType='asyncapi'. Without that check
  // dashboard-launched Create / Edit / View modals fall through to the
  // swagger editor.
  const isAsyncApi = context.moduleKey.startsWith('zenuml-asyncapi-macro') || isAsyncApiEmbed || context.extension.modal?.diagramType === 'asyncapi';

  let doc: Diagram | undefined;
  let diagramAttribution = null;
  let ccLoadError: DiagramLoadError | null = null;
  let legacyLoadBlocked = false;
  // A macro created by pasting a typed diagram deeplink
  // (.../d/<type>/<cloudId>/<contentId>) has no config yet — the id is in the
  // matched URL. Deriving it here is what makes that paste an ORDINARY,
  // editable macro rather than an embed: the embed macro renders a diagram
  // but its editor is a document picker, so a diagram placed that way could
  // never be edited again. The link persists in the page ADF, so this keeps
  // resolving on every later render with no config write needed.
  const customContentId = resolveEffectiveCustomContentId(context);
  originalCustomContentId = customContentId;
  recoveryPageId = context.extension?.content?.id;
  // ZEN-1170 Defect 1: see forge-graph-editor.ts for why this uses
  // config.uuid and not forgeGlobal.localId.
  const storageUuid: string | undefined = context.extension?.config?.uuid;

  // Viewer surfaces skip the full-page ADF scan entirely: the zero-network
  // cross-page comparison (ApWrapper2.detectCrossPageCopy) preserves the
  // cross-page banner and Edit gating, while same-page-duplicate detection
  // lives on the edit/config surfaces, whose blocking detectCopy guards
  // the save-fork path. Scoped to isSequence — see the comment on that
  // const above for why graph/embed/asyncapi (own entry files, own doc
  // loads) must keep the default.
  const isEditorish =
    context.extension.modal?.macroMode === 'editor' ||
    !!context.extension?.macro?.isConfiguring;
  const copyCheckMode = isSequence && !isEditorish ? ('cross-page-only' as const) : ('full' as const);

  // ── Viewport render gate (#382) ──────────────────────────────────────────
  // Plain sequence-family VIEWER only (same scope as the content-SWR block
  // below): on a many-macro page all iframes co-boot within ~20ms and their
  // CPU work serializes on the shared renderer main thread (measured on
  // lite-dev: warm solo 1.3s vs 16-macro 5.3s per macro). The gate defers
  // the heavy mount until this macro is in/near the top-level viewport
  // (IntersectionObserver implicit root — works from a cross-origin
  // iframe), with a jittered background fill so offscreen macros — and
  // no-scroll consumers like snapshot backfill — still render. Zero
  // cross-macro communication; fail-open everywhere; flag-gated
  // (viewport-gated-render, fail-closed, localStorage-cached verdict).
  // Started here (pre-fetch) so observers and the flag refresh run
  // concurrently with the content load; awaited at the mount points.
  const viewerGatePromise: Promise<void> | null =
    isSequence && !(await isEditorMode()) && !(await isFullscreenMode())
      ? maybeGateViewerRender()
      : null;

  // ── Content SWR: cache-first render on a viewer revisit ──────────────────
  // Most macro views are revisits of unchanged content (measured: ~66% of
  // sequence-family viewer views in a week are a repeat of the same user +
  // customContentId, with no save landing in between) and the view's time is
  // dominated by the content fetch. The cache is keyed by customContentId —
  // known from the Forge context BEFORE any fetch — so on a hit we mount the
  // cached doc immediately and revalidate in the background, taking the
  // fetch off the critical path.
  //
  // Scoped to the plain (non-fullscreen) sequence-family VIEWER: it's the
  // dominant macro_viewed surface and is read-only (no save path → no
  // data-loss risk). Fullscreen is excluded so its paywall gate still fires;
  // the editor is excluded because its load drives save/recovery/paywall
  // logic. Deliberately calls `await isEditorMode()` here rather than
  // reusing the `isEditorish` const above — that const is a narrower
  // synchronous heuristic scoped only to the ADF-scan copyCheckMode gate;
  // this needs to match `editable` (computed the same way, further below)
  // exactly, since that's the real switch between the Workspace and
  // DiagramPortal mount paths.
  //
  // Orphan-recovery reporting and the cross-page SnapshotAttachment backfill
  // are NOT run on the instant cache-hit render — there's no fresh `loaded`
  // result to report from at that point, and a cache hit means recovery for
  // this ccid isn't in question anyway (we're serving previously-fetched
  // valid content, not resolving a possibly-orphaned id). Both still run
  // inside revalidateSequenceViewer below, which performs the real fetch
  // moments later, so nothing is silently dropped — it's deferred off the
  // critical path, same as the fetch itself.
  // See utils/renderCache/contentCacheStore.ts.
  const mountSequenceViewer = async (viewerDoc: Diagram, attribution: DiagramAttribution | null = null) => {
    // #382: hold the mount until the viewport gate releases (the gate shows
    // its own shimmer placeholder while holding — index.html has no real
    // skeleton element). awaitGateBlocking also records the ACTUAL wait at
    // this mount site as render_deferred_ms. Resolved instantly when the
    // flag is off; already-resolved for the revalidate re-mount.
    await awaitGateBlocking(viewerGatePromise);
    const { mountRoot } = await import('@/mount-root');
    const DiagramPortal = (await import('@/components/DiagramPortal.vue')).default;
    // @ts-ignore - viewerDoc may be a partial spread type; matches the happy-path mount below
    mountRoot(viewerDoc, DiagramPortal, { autoResize: true });
    publishDiagramAttribution(attribution);
    // BUG FIX (overnight verification run, 2026-08-19): this SWR mount path
    // (both the cache-hit render and the revalidate re-mount) never used to
    // call setViewerLoadState — only the direct-fetch path further below
    // (via applyViewerLoadOutcome) did. store.state.viewerLoadState
    // therefore stayed at its initial `null` forever for any render that
    // took this path, which per the comment above this function is ~66% of
    // all sequence-family viewer views. Every consumer gated on
    // `viewerLoadState === 'ready'` — SecondDiagramPrompt's `ready` prop,
    // and DiagramAttributionFooter's registerDiagramImpactView call — was
    // silently starved on the majority of real revisits. mountSequenceViewer
    // already knows the doc is renderable (it's what's on screen), so
    // classify it the same way applyViewerLoadOutcome does rather than
    // hardcoding 'ready' — an empty/blank cached doc (should one ever get
    // primed) still reports the correct failed state instead of a false
    // 'ready'. Extracted to setSequenceViewerLoadState (viewerLoadOutcome.ts)
    // so this one-line classify-and-publish step has a unit test —
    // forgeIndex.ts itself has no test harness (module-level side effects
    // on import) — see setSequenceViewerLoadState's regression test in
    // viewerLoadOutcome.spec.ts.
    setSequenceViewerLoadState(viewerDoc);
  };

  const revalidateSequenceViewer = async (
    ccId: string,
    pageId: string | undefined,
    cachedHash: string,
  ) => {
    try {
      const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(
        pageId, ccId, { copyCheckMode },
      );
      if (loaded.recoveredFromOrphanId && loaded.customContent?.value) {
        reportOrphanObserved(pageId, ccId, 'sequence', loaded.probeResult, {
          recoveryUsed: true,
          recoveredId: loaded.customContent?.id != null ? String(loaded.customContent.id) : undefined,
        });
      } else if (!loaded.customContent?.value) {
        reportOrphanObserved(pageId, ccId, 'sequence', loaded.probeResult, { recoveryUsed: false });
      }
      const fresh = loaded.customContent?.value;
      if (!fresh) return; // content unreadable now — keep the last-known-good cached render
      const freshAttribution = attributionFromCustomContent(loaded.customContent);
      if (loaded.customContent) {
        import('@/model/SnapshotAttachment').then(({ maybeBackfillSnapshot }) =>
          maybeBackfillSnapshot({
            hostPageId: String(pageId),
            ccId: String(ccId),
            ccPageId: loaded.customContent!.pageId,
            diagram: fresh,
            ccVersion: loaded.customContent!.version?.number,
            isDisplayMode: globals.apWrapper.isDisplayMode(),
          })
        ).catch(e => console.debug('[snapshot] backfill skipped', e));
      }
      const serialized = JSON.stringify(fresh);
      putCachedContent(ccId, serialized, freshAttribution);
      if (hashContent(serialized) !== cachedHash) {
        renderPerf.markContentSource('fetch');
        // @ts-ignore - fresh may be a partial spread type; matches the happy-path mount below
        const freshDoc: Diagram = fresh.plantUmlCode ? fresh : { ...fresh, plantUmlCode: Example.PlantUml };
        await mountSequenceViewer(freshDoc, freshAttribution);
      }
    } catch (e) {
      console.warn('[content-swr] background revalidate failed; cached render stands', e);
    }
  };

  if (customContentId && isSequence && !(await isEditorMode()) && !(await isFullscreenMode())) {
    const cached = getCachedContent(customContentId);
    if (cached) {
      try {
        const cachedDoc = JSON.parse(cached.doc) as Diagram;
        // @ts-ignore - cachedDoc may be a partial spread type; matches the happy-path mount below
        const viewerDoc: Diagram = cachedDoc.plantUmlCode ? cachedDoc : { ...cachedDoc, plantUmlCode: Example.PlantUml };
        renderPerf.markContentSource('swr_cache');
        // Revalidate BEFORE the (possibly gated) mount: an offscreen macro
        // must not delay its freshness check / orphan reporting / snapshot
        // backfill until the viewport gate releases (#384 review F4). If
        // the content changed, revalidate's own mountSequenceViewer call
        // awaits the same gate and lands after this cached mount, so the
        // fresh doc still wins.
        //
        // gate_mode='load' (#382, the default) deliberately reverses F4:
        // on a storm page the revalidate fetches are exactly the broker
        // load we're trying to shed, and the colesgroup canary showed ~98%
        // of these mounts are never seen. Freshness/orphan checks still
        // run — at gate release (≤ background-fill 3–7s later), not
        // immediately.
        if (viewerGatePromise && getGateMode() === 'load') {
          void viewerGatePromise.then(() =>
            revalidateSequenceViewer(customContentId, recoveryPageId, cached.hash));
        } else {
          void revalidateSequenceViewer(customContentId, recoveryPageId, cached.hash);
        }
        // Attribution comes from the cache entry: this path returns without ever
        // reaching the fetch that derives it. An entry written before the cache
        // carried attribution mounts without a footer; the background revalidate
        // rewrites the entry with attribution, but only re-mounts when the content
        // hash changed — so such an entry shows its footer from the NEXT visit on.
        await mountSequenceViewer(viewerDoc, cached.attribution ?? null);
        return; // rendered from cache — skip the live-fetch + mount path entirely
      } catch (e) {
        console.warn('[content-swr] cache hit failed to render; falling back to live fetch', e);
        // fall through to the normal fetch path below
      }
    }
  }

  if (isSequence && customContentId) {
    // gate_mode='load' (#382, the default): hold the content fetch itself
    // until the viewport turn, so an offscreen mount costs ~boot+context
    // until released. viewerGatePromise is null for editors/fullscreen
    // (await is then a no-op) and render_deferred_ms is recorded HERE
    // (first await wins), so it means "wait before the load began" and
    // fetch_ms stays a clean network measure starting at release.
    if (getGateMode() === 'load') {
      await awaitGateBlocking(viewerGatePromise);
    }
    const loaded = await renderPerf.time('fetch', () =>
      globals.apWrapper.loadCustomContentWithOrphanRecovery(recoveryPageId, customContentId, { copyCheckMode }));
    console.debug('Loaded custom content', loaded.customContent, 'recoveredFromOrphan?', loaded.recoveredFromOrphanId);
    doc = loaded.customContent?.value;
    diagramAttribution = attributionFromCustomContent(loaded.customContent);
    if (isSequence && loaded.customContent?.value) {
      // Prime the id-keyed SWR cache so a later viewer revisit can render
      // before the fetch (see the content-SWR block above). Cache the RAW
      // fetched value (pre-backfill) so its hash matches a future fetch for
      // change detection; a stale entry self-corrects on the next
      // revalidate's hash comparison. Primed from both editor and viewer
      // loads — either is a legitimate source of "current truth" for a
      // later viewer revisit.
      putCachedContent(customContentId, JSON.stringify(loaded.customContent.value), diagramAttribution);
      renderPerf.markContentSource('fetch');
    }
    if (loaded.recoveredFromOrphanId && doc) {
      doc.recoveredFromOrphan = true;
      doc.recoveredFromOrphanId = loaded.recoveredFromOrphanId;
      reportOrphanObserved(recoveryPageId, customContentId, 'sequence', loaded.probeResult, {
        recoveryUsed: true,
        recoveredId: loaded.customContent?.id != null ? String(loaded.customContent.id) : undefined,
      });
    } else if (!doc) {
      // ZEN-1170: the referenced customContent failed to load AND no page
      // child was a confident match. Don't assign doc here — let the legacy
      // content-property fallback below try storageUuid before we mount an
      // empty/example doc and risk a destructive save.
      reportOrphanObserved(recoveryPageId, customContentId, 'sequence', loaded.probeResult, { recoveryUsed: false });
      ccLoadError = mapCustomContentLoadError(loaded);
    }

    // Diagram source snapshot attachments (docs/superpowers/plans/
    // 2026-07-18-diagram-source-snapshot-attachments.md, Task 4): when this
    // editor surface is previewing a cross-page alias (the CC's own pageId
    // differs from the page hosting THIS macro), backfill a snapshot onto
    // the host page — write permission here is guaranteed (editor surface),
    // unlike a plain viewer render. Fire-and-forget: never on the critical
    // rendering path, and maybeBackfillSnapshot itself never throws.
    if (doc && loaded.customContent) {
      import('@/model/SnapshotAttachment').then(({ maybeBackfillSnapshot }) =>
        maybeBackfillSnapshot({
          hostPageId: String(recoveryPageId),
          ccId: String(customContentId),
          ccPageId: loaded.customContent!.pageId,
          diagram: doc!,
          ccVersion: loaded.customContent!.version?.number,
          isDisplayMode: globals.apWrapper.isDisplayMode(),
        })
      ).catch(e => console.debug('[snapshot] backfill skipped', e));
    }

    // Editor staleness hint (docs/superpowers/specs/
    // 2026-07-18-job-b-editor-staleness-hint-design.md): on inline
    // page-editor renders only, offer a drift-based "update this diagram"
    // strip. Fire-and-forget like the snapshot backfill above — never on
    // the render critical path, and the module gates itself (surface,
    // type, flag, drift, dismissal) and never throws.
    //
    // Integration facts (task-4-report.md):
    //  - macro type: `doc.diagramType` (src/model/Diagram/Diagram.ts) is
    //    already the same lowercase string the orchestrator's
    //    HINT_MACRO_TYPES set expects ('sequence'|'mermaid'|'plantuml'|
    //    'graph') — no derivation from isSequence/isAsyncApi needed.
    //  - CTA: EventBus.$emit('edit') is the SAME mechanism the viewer
    //    toolbar's real Edit button uses (GenericViewer.vue's edit()
    //    method) — handled by the EventBus.$on('edit', ...) listener
    //    below, which opens the fullscreen editor modal.
    if (doc && loaded.customContent?.version) {
      import('@/utils/stalenessHint/maybeShowStalenessHint').then(({ maybeShowStalenessHint }) =>
        maybeShowStalenessHint({
          context,
          macroType: doc!.diagramType,
          ccId: String(customContentId),
          ccLastModified: loaded.customContent!.version!.createdAt,
          ccAuthorId: loaded.customContent!.version!.authorId,
          onCta: () => EventBus.$emit('edit'),
        })
      ).catch(e => console.debug('[staleness-hint] wiring skipped', e));
    }
  }

  // ZEN-1170 Defect 1: try the legacy content-property fallback whenever
  // the custom-content path didn't yield a doc AND a legacy storageUuid
  // exists. Covers both pure-legacy macros (no customContentId) AND mixed-
  // state macros (stale customContentId that 404s, but the original legacy
  // body still lives on the page). Without this, a mixed-state macro
  // mounts the example DSL and a save would replace the legacy body.
  if (isSequence && !doc && storageUuid) {
    const result = await globals.apWrapper.getContentPropertyV2(
      `zenuml-sequence-macro-${storageUuid}-body`,
    );
    if (result.status === 'ok') {
      const value = result.property.value;
      if (value && typeof value === 'object') {
        // Reuse Defect 2b's recoveredFromOrphan for UI gating. See
        // forge-graph-viewer.ts for the rationale.
        // ZEN-1170 Defect 1: object-shaped legacy sequence properties may
        // lack `diagramType` entirely (the field was added later). The
        // original ContentPropertyStorageProvider._normaliseContentProperty
        // unconditionally defaulted to Sequence, which is wrong for
        // mermaidCode-only / plantUmlCode-only legacy bodies — they'd
        // render blank under the Sequence component and a downstream
        // save would persist them as Sequence CC, hiding the original
        // diagram semantics. Infer from populated fields instead.
        const restored = value as Diagram;
        // Trust stored diagramType only when it's a valid renderable type
        // (Sequence/Mermaid/PlantUml). DiagramType.Unknown is a valid enum
        // value but a sentinel for "we don't know" — letting it through
        // would mount no renderer + a downstream save could persist a CC
        // record typed 'unknown' that hides the legacy body. Treat
        // Unknown the same as missing → fall through to content-field
        // inference, matching the existing CompositeContentProvider guard
        // that converts undefined/Unknown to Sequence before returning.
        //
        // Inference precedence matches the legacy
        // ContentPropertyStorageProvider getDiagramType(): code first
        // (Sequence is the dominant legacy shape), then mermaidCode,
        // then plantUmlCode. Default to Sequence for empty objects.
        const VALID_DIAGRAM_TYPES: ReadonlyArray<DiagramType> = [
          DiagramType.Sequence, DiagramType.Mermaid, DiagramType.PlantUml,
        ];
        const storedTypeIsValid = restored.diagramType
          && VALID_DIAGRAM_TYPES.includes(restored.diagramType);
        const inferredDiagramType = storedTypeIsValid
          ? restored.diagramType!
          : (restored.code ? DiagramType.Sequence
            : restored.mermaidCode ? DiagramType.Mermaid
            : restored.plantUmlCode ? DiagramType.PlantUml
            : DiagramType.Sequence);
        doc = {
          ...restored,
          diagramType: inferredDiagramType,
          source: DataSource.ContentProperty,
          id: undefined,
          recoveredFromOrphan: true,
        };
        reportLegacyContentPropertyRestored('editor', 'sequence', storageUuid, { pageId: recoveryPageId });
      } else if (typeof value === 'string') {
        // Pre-2024 sequence macros stored the DSL as a bare string. Mirror
        // ContentPropertyStorageProvider._normaliseContentProperty so we
        // restore the diagram instead of falling through to the example.
        doc = {
          diagramType: DiagramType.Sequence,
          source: DataSource.ContentPropertyOld,
          code: value,
          id: undefined,
          recoveredFromOrphan: true,
        } as Diagram;
        reportLegacyContentPropertyRestored('editor', 'sequence', storageUuid, { pageId: recoveryPageId, valueType: 'string_legacy' });
      } else {
        legacyLoadBlocked = true;
        reportLegacyContentPropertyValueUnexpected('editor', 'sequence', storageUuid, value == null ? 'null' : 'other');
      }
    } else if (result.status === 'forbidden') {
      legacyLoadBlocked = true;
      reportLegacyContentPropertyLoadFailed('editor', 'sequence', storageUuid, 'forbidden', { pageId: recoveryPageId });
    } else if (result.status === 'page_not_found') {
      // See forge-graph-editor.ts: fail closed on V2 404 (page not reachable
      // != key absent). Refuse save so we never overwrite legacy data on a
      // page we couldn't probe.
      legacyLoadBlocked = true;
      reportLegacyContentPropertyLoadFailed('editor', 'sequence', storageUuid, 'http', { pageId: recoveryPageId, httpStatus: 404 });
    } else if (result.status === 'error') {
      legacyLoadBlocked = true;
      reportLegacyContentPropertyLoadFailed('editor', 'sequence', storageUuid, result.reason, { pageId: recoveryPageId, httpStatus: result.httpStatus });
    }
    // status === 'not_found' (200 + empty results) falls through to the
    // example/new path below as a legitimate "no legacy data" case.
  }

  // ZEN-1170 Defect 1 sibling (PR #139): cross-page-paste recovery via
  // uuid → CC title. The content-property step above only checks THIS
  // page; a Connect-era sequence macro copy-pasted to a new page has no
  // property here — its body survives only as a CustomContent on the
  // SOURCE page, titled with the uuid. Without this fallback the editor
  // would mount Example.Sequence and a first save would silently wipe
  // the recovered diagram the viewer is showing (PR #139 viewer step 3).
  if (isSequence && !doc && storageUuid) {
    const recovered = await globals.apWrapper.findLegacyCustomContentByUuid(storageUuid);
    if (recovered?.value) {
      doc = recovered.value;
      doc.recoveredFromOrphan = true;
      // Step 2 may have set legacyLoadBlocked if its property check was
      // indeterminate (403/page-not-found/parse-error). Clear it: step 3
      // found a real CC on a different storage layer — saving creates a
      // new CC, it cannot overwrite the content property we couldn't read.
      legacyLoadBlocked = false;
      trackEvent(storageUuid, 'legacy_custom_content_by_uuid_restored', 'info', {
        surface: 'editor',
        macro_type: 'sequence',
        recovered_id: String(recovered.id ?? ''),
        is_copy: doc.isCopy ? 'true' : 'false',
        ...(recoveryPageId && { page_id: recoveryPageId }),
      });
    }
  }

  // Snapshot-attachment fallback (docs/superpowers/plans/2026-07-18-diagram-source-snapshot-attachments.md):
  // the CC is unreachable (deleted source page or no read access — the API
  // returns NOT_FOUND for both) and no legacy body exists. Render the host
  // page's own snapshot so the macro doesn't go dark.
  if (!doc && customContentId && recoveryPageId) {
    const { fetchSnapshot, snapshotToDiagram } = await import('@/model/SnapshotAttachment');
    const snapshot = await fetchSnapshot(String(recoveryPageId), String(customContentId));
    if (snapshot) {
      const restored = snapshotToDiagram(snapshot);
      if (restored.diagramType !== DiagramType.Unknown) {
        doc = restored;
        const ageDays = Math.floor((Date.now() - new Date(snapshot.snapshotAt).getTime()) / 86400000);
        trackAnalyticsEvent('snapshot_fallback_rendered', {
          feature_area: 'macro', surface: 'viewer',
          custom_content_id: String(customContentId), snapshot_age_days: ageDays,
        });
      }
    }
  }

  // A ZEN-1170 recovery above restored the body after the customContent
  // fetch set ccLoadError, so the error no longer describes this load.
  // Clear it BEFORE the placeholder/example branches below, which are not
  // recoveries and must keep reporting the failure.
  if (doc && ccLoadError) {
    ccLoadError = null;
  }

  // ZEN-1170 (pre-Defect-1 behavior preserved): when CC was attempted but
  // failed AND we have no legacy storageUuid to try AND legacy fallback
  // wasn't blocked, mount the placeholder empty doc so the wipe-precursor
  // telemetry + per-macro-type dispatch below can run.
  // CRITICAL: gate on !legacyLoadBlocked. If the legacy fallback set the
  // sentinel (e.g. mixed-state with 403/5xx on the property read), the
  // blocked-doc branch below MUST be the one that runs — otherwise the
  // placeholder NULL_DIAGRAM would erase the sentinel and persistence
  // would happily save an empty doc over the legacy body.
  if (isSequence && !doc && customContentId && !legacyLoadBlocked) {
    doc = { ...NULL_DIAGRAM };
  }
  if (isSequence && !doc) {
    if (legacyLoadBlocked) {
      // Mount a degraded, save-blocked diagram. Persistence layer will
      // refuse the save; the user sees the editor but cannot destroy the
      // legacy data.
      doc = {
        diagramType: DiagramType.Sequence,
        code: '',
        mermaidCode: '',
        plantUmlCode: '',
        isNew: false,
        legacyLoadBlocked: true,
      } as Diagram;
    } else {
      doc = {
        diagramType: DiagramType.Sequence,
        code: Example.Sequence,
        mermaidCode: Example.Mermaid,
        plantUmlCode: Example.PlantUml,
        isNew: true,
      };
    }
  }

  // Capture the active field for wipe-precursor telemetry BEFORE any
  // default-value backfill (e.g. plantUmlCode default below). Whether we
  // actually emit the event is decided later after `isEditorMode()` so
  // we don't pollute the signal with viewer page loads.
  let wipePrecursorMacroType: MacroTypeValue | null = null;
  let wipePrecursorActiveFieldEmpty = false;
  if (customContentId && doc) {
    const loadedDoc = doc;
    let activeField: string | undefined | null;
    if (loadedDoc.diagramType === DiagramType.Mermaid) {
      wipePrecursorMacroType = 'mermaid';
      activeField = loadedDoc.mermaidCode;
    } else if (loadedDoc.diagramType === DiagramType.PlantUml) {
      wipePrecursorMacroType = 'plantuml';
      activeField = loadedDoc.plantUmlCode;
    } else if (loadedDoc.diagramType === DiagramType.Sequence) {
      wipePrecursorMacroType = 'sequence';
      activeField = loadedDoc.code;
    }
    // Treat undefined/null the same as "" — partial/corrupt loads (field
    // absent) are the same wipe-risk shape as explicit empty string.
    wipePrecursorActiveFieldEmpty = !activeField;
  }

  // Backfill default PlantUML DSL for existing diagrams created before PlantUML
  // support. `doc` is only populated for the sequence family above; non-sequence
  // types leave it undefined (the dedicated entry loads their doc), so guard.
  if (doc && !doc.plantUmlCode) {
    doc = { ...doc, plantUmlCode: Example.PlantUml };
  }

  // Start journey tracking for editor mode
  const editable = await isEditorMode();
  if (editable) {
    // Refresh the macro-count cache while the editor is open. This is the safe
    // place for the full enumeration (~10s for a large space): the editing
    // session keeps the iframe alive long enough to finish and write KV,
    // whereas firing it on save races the editor teardown (view.submit/close)
    // and gets killed mid-collect. Fire-and-forget so it never blocks startup.
    macroMetrics.reportMacroMetrics().catch(e => console.debug('Metrics reporting failed (non-critical)', e));

    originalConfigUuid = context.extension?.config?.uuid;
    const macroUuid =
      forgeGlobal.forgeContext?.localId
      || context.extension?.config?.uuid
      || uuidv4();
    const isDialog = !!context.extension?.modal;
    const isMacroConfig = !!context.extension?.macro?.isConfiguring || !!context.extension?.macro?.isInserting;

    if (isDialog || isMacroConfig) {
      // Check if journey was passed from parent (for modals opened from viewer)
      const modalContext = context.extension?.modal;
      if (isDialog && modalContext?.journey_id) {
        continueEditJourney(modalContext.journey_id, macroUuid, modalContext.journey_start_time);
      } else {
        const source = isMacroConfig ? 'macro' : 'dialog';
        startEditJourney(macroUuid, source);
      }
    }

    // Ensure session is initialized
    getOrCreateSession();

    // Editor-side backstop for the in-viewer Edit gate (model/editDupGate.ts):
    // if a copy-flagged doc still reached a surface where view.submit({config})
    // cannot persist (gate fail-open, staleness-hint CTA, any other
    // non-submittable entry), saving would fork a CC nothing references —
    // #170's gate then silently view.close()s and the edit vanishes from the
    // page. Disable Publish up front instead (Header.vue + the 'save'
    // handler both read store.state.publishBlock).
    const publishBlock = decidePublishBlock({
      isCopy: !!doc?.isCopy,
      copyReason: (doc as any)?.copyReason,
      inserting: !!context.extension?.macro?.isInserting,
      configuring: !!context.extension?.macro?.isConfiguring,
    });
    if (publishBlock) {
      store.commit('setPublishBlock', publishBlock);
      trackAnalyticsEvent('editor_publish_blocked_fork_unlinkable', {
        feature_area: 'macro',
        surface: 'editor',
        macro_type: (doc?.diagramType as MacroTypeValue) || 'sequence',
        copy_reason: publishBlock,
      });
    }

    // Wipe-precursor telemetry: fire only in editor mode so the signal
    // isn't drowned by viewer page-view volume. The captured state above
    // reflects the RAW loaded doc before any backfill.
    if (customContentId && wipePrecursorMacroType && wipePrecursorActiveFieldEmpty) {
      trackAnalyticsEvent('editor_load_empty_active_field', {
        feature_area: 'macro',
        surface: 'editor',
        macro_type: wipePrecursorMacroType,
        content_id: customContentId,
      });
    }
  }

  // #382: gated fetch-path viewer renders wait here (the gate shows its own
  // shimmer placeholder while holding — index.html has no real skeleton
  // element). Null for editors/fullscreen/non-sequence; resolved for
  // SWR-hit renders (mountSequenceViewer already awaited it above).
  // awaitGateBlocking records the actual mount wait as render_deferred_ms.
  await awaitGateBlocking(viewerGatePromise);

  // Paste-to-create seeding. A macro produced by pasting a
  // `https://confluence.zenuml.com/new/<type>` link carries that URL as
  // `autoConvertLink`; it names the type the user picked in the byline modal,
  // which is otherwise unknowable here because the editor opens on a blank
  // macro. Only ever applies to a macro with no stored content — an existing
  // diagram's own type always wins — so a link that somehow survives on a
  // saved macro can never re-type it.
  // Gate on `!customContentId` (a macro with nothing stored yet), NOT on
  // `!doc`. The sequence family assigns its own placeholder doc above —
  // diagramType Sequence with all three example bodies pre-filled — so a
  // `!doc` guard silently skipped exactly the family this feature is for:
  // measured 2026-08-01, `/new/graph` and `/new/openapi` seeded while
  // `/new/mermaid` pasted as a sequence diagram, because only the sequence
  // branch had already populated `doc`.
  {
    const seeded = applyNewDiagramLink(doc, readAutoConvertLink(context), !!customContentId);
    doc = seeded.doc;
    // Second source: an editor opened from a non-macro surface (the byline
    // type picker) states the chosen type in `modal.diagramType`. forgeIndex
    // consulted that field for ROUTING only, so the doc kept the
    // sequence-family placeholder's Sequence and picking Flowchart opened a
    // sequence editor.
    const fromModal = seeded.seededType
      ? { doc, seededType: undefined as any }
      : applyRequestedDiagramType(
          doc,
          diagramTypeFromModalType(context.extension.modal?.diagramType),
          !!customContentId,
        );
    doc = fromModal.doc;
    const seededType = seeded.seededType || fromModal.seededType;
    if (seededType) {
      // Normalised, not the raw enum: DiagramType.OpenApi is 'OpenAPI', and
      // emitting it verbatim splits Mixpanel's macro_type into two buckets
      // ('OpenAPI' here, 'openapi' from every other surface) — the exact join
      // breakage toMacroType exists to prevent.
      const { toMacroType } = await import('@/utils/byline/pageDiagrams');
      trackEvent('', 'new_diagram_link_seeded', 'macro', { macro_type: toMacroType(seededType) });
    }
  }

  // isSequence / isGraph / isEmbed / isAsyncApiEmbed / isAsyncApi are computed
  // earlier now (hoisted above the customContentId load) so BOTH the P1.1
  // ADF-scan deferral gate AND the sequence-family load/telemetry gate reuse
  // them — see that block for the rationale.

  if(isSequence) {
    const macroKind = (doc?.diagramType === DiagramType.Mermaid || context.extension.modal?.diagramType === 'mermaid') ? 'mermaid' : 'sequence';
    const fullscreenMode = await isFullscreenMode();
    const trackPageEditorAuthoringStarted = () => {
      const isNew = !customContentId;
      const macroType: MacroTypeValue = (doc?.diagramType as MacroTypeValue) || 'sequence';
      if (isNew) {
        trackAnalyticsEvent("macro_create_started", {
          feature_area: "macro",
          surface: "editor",
          macro_type: macroType,
          entry_point: "page_editor",
        });
      } else {
        trackAnalyticsEvent("macro_edit_started", {
          feature_area: "macro",
          surface: "editor",
          macro_type: macroType,
          entry_point: "macro_toolbar",
        });
      }
    };

    // Editor paywall: mount Workspace under PaywallGate so the iframe is
    // never blank; save remains gated in the persistence layer.
    if (editable) {
      // @ts-ignore - Workspace's Split() helper checks window.split
      window.split = true;
      const Workspace = (await import('@/components/Workspace.vue')).default;
      if (await tryPageEditorPaywall({
        // @ts-ignore - doc may be a partial spread type; matches the happy-path mount below
        doc: doc ?? NULL_DIAGRAM,
        content: Workspace,
        contentProps: { autoResize: !fullscreenMode },
        macroKind,
        customContentId,
        // The gated path returns before the ordinary post-mount telemetry
        // below. Defer the same authoring event to the explicit continue
        // action: a user who closes the paywall never started authoring.
        onContinueEditing: trackPageEditorAuthoringStarted,
      })) return;
    }

    // Fullscreen viewer paywall: blocking modal over the read-only diagram.
    // Fires only when the user clicked Fullscreen on a saturated Lite space.
    if (!editable && fullscreenMode) {
      const DiagramPortal = (await import('@/components/DiagramPortal.vue')).default;
      if (await tryFullscreenViewerPaywall({
        // @ts-ignore - doc may be a partial spread type; matches the happy-path mount below
        doc,
        content: DiagramPortal,
        contentProps: { autoResize: false },
        macroKind,
      })) return;
    }

    const component = editable
    ? (await import("@/components/Workspace.vue")).default
    : (await import("@/components/DiagramPortal.vue")).default;

    const mountDoc = editable
      ? doc
      : applyViewerLoadOutcome({
          doc,
          customContentId,
          loadError: ccLoadError,
          macroKind,
        });

    //@ts-ignore
    mountRoot(mountDoc, component, { autoResize: !editable && !fullscreenMode });
    if (!editable) publishDiagramAttribution(diagramAttribution);

    if (editable) {
      trackPageEditorAuthoringStarted();
    }
  } else if(isGraph) {
    await import(editable ? "@/forge-graph-editor" : "@/forge-graph-viewer");
  } else if(isEmbed) {
    await import(editable ? "@/forge-embed-editor" : "@/forge-embed-viewer");
  } else if(isAsyncApi && (import.meta.env.PRODUCT_TYPE === 'asyncapi' || import.meta.env.PRODUCT_TYPE === 'lite')) {
    // Build-time literal: Vite replaces PRODUCT_TYPE via `define` so
    // full/diagramly short-circuit and dead-code-eliminate the dynamic
    // import. Keeps @asyncapi/parser (which pulls in Node `fs`) out of
    // the full/diagramly dependency graph entirely. Lite ships the
    // AsyncAPI macro per ADR-0005 Option A: forgeGlobal.isAsyncApi stays
    // FALSE there, so ApWrapper2.getContentKey() files the content under
    // the shared zenuml-content-sequence type (discriminated by the
    // body's diagramType), like OpenAPI — which is what keeps the Lite
    // paywall count, enumeration, and copy-scan covering these macros.
    //
    // Three entry points for the asyncapi variant:
    //  - regular macro view  → forge-asyncapi-viewer
    //  - regular macro edit  → forge-asyncapi-editor (Studio iframe)
    //  - embed macro edit    → forge-asyncapi-embed-editor (doc picker)
    // The embed macro VIEW reuses forge-asyncapi-viewer — same code
    // path, reads extension.config.customContentId either way.
    if (editable) {
      // The embed picker persists only via view.submit(), which throws
      // "view is not submittable" in the view-mode Edit modal
      // (modal.macroMode === 'editor') — routing it there made re-targeting
      // an embed silently fail with "Failed to embed document.". Only open
      // the picker from the native page-editor config surface; from the
      // view-mode Edit modal, edit the referenced document's spec instead.
      const isViewModeEditModal = context.extension?.modal?.macroMode === 'editor';
      const entry = resolveAsyncApiEditorEntry({
        isEmbedMacro: isAsyncApiEmbed,
        isViewModeEditModal,
      });
      await import(entry === 'embed-picker'
        ? "@/forge-asyncapi-embed-editor"
        : "@/forge-asyncapi-editor");
    } else {
      await import("@/forge-asyncapi-viewer");
    }
  } else {
    await import(editable ? "@/forge-swagger-editor" : "@/forge-swagger-ui");
  }

  // Last, and for every macro kind: if THIS macro is the one the user just
  // placed from the byline or the banner, pull the reloaded page down to it and
  // ring it. Placed here rather than in each viewer because the note is keyed
  // by customContentId, which is the same fact whatever renders it. Never
  // awaited and never throws — the diagram is on the page either way.
  if (!editable) void maybeRevealPlacedMacro(recoveryPageId, customContentId, doc?.diagramType);
}

/**
 * The receiving half of the one-click place (see utils/byline/revealDiagram.ts
 * for why a focus is what scrolls Confluence).
 *
 * Waits for the macro to stop growing first. The iframe is sized by its
 * content, so focusing while the diagram is still rendering would scroll to a
 * box that is about to move — the scroll has to be the last thing that happens.
 */
async function maybeRevealPlacedMacro(
  pageId: string | undefined,
  customContentId: string | undefined,
  diagramType: string | undefined,
) {
  try {
    const { claimReveal, revealThisMacro } = await import('@/utils/byline/revealDiagram');
    const ageMs = claimReveal(pageId, customContentId);
    if (ageMs === null) return;

    await settled();
    revealThisMacro();

    const [{ trackAnalyticsEvent }, { toMacroType }] = await Promise.all([
      import('@/utils/analytics/trackAnalyticsEvent'),
      import('@/utils/byline/pageDiagrams'),
    ]);
    trackAnalyticsEvent('diagram_revealed', {
      feature_area: 'byline',
      surface: 'macro',
      ...(diagramType ? { macro_type: toMacroType(diagramType) } : {}),
      reveal_age_ms: ageMs,
    });
  } catch (e) {
    console.debug('[reveal] skipped', e);
  }
}

/** Resolve once the document has held the same height twice in a row, or at the deadline. */
function settled(deadlineMs = 4000, quietMs = 250): Promise<void> {
  return new Promise(resolve => {
    const started = Date.now();
    let last = -1;
    const tick = () => {
      const h = document.documentElement.scrollHeight;
      if (h === last || Date.now() - started > deadlineMs) return resolve();
      last = h;
      window.setTimeout(tick, quietMs);
    };
    window.setTimeout(tick, quietMs);
  });
}

// Main function to orchestrate the two-phase loading
async function main() {
  // Phase 1: Critical path rendering
  const criticalData = await initializeCriticalPath();

  // Phase 2: Load heavy components
  loadHeavyComponents(criticalData).catch(e =>
    console.error('Failed to load heavy components:', e)
  );
}

export default main()

// Connect-era 'diagramLoaded' resize handler removed: the host-iframe resize
// bridge call has no @forge/bridge equivalent (Custom UI iframes auto-size),
// so the handler was a silent no-op in pure Forge.

// Dynamically import createAttachmentIfContentChanged only when needed
const createAttachmentIfContentChangedPromise = import("@/model/Attachment").then(
  module => module.default
);

async function createAttachment(code: string, diagramType: DiagramType) {
  try {
    // ZEN-1170 Defect 1: the missing-customContentId case is handled
    // centrally inside createAttachmentIfContentChanged (Attachment.ts)
    // — it emits the `missing_custom_content_id` skip telemetry and
    // returns early. Per-callsite fast paths previously here suppressed
    // that central event, hiding the highest-volume class of skips.
    if (globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()) {
      const createAttachmentIfContentChanged = await createAttachmentIfContentChangedPromise;
      await createAttachmentIfContentChanged(code, diagramType);
    } else {
      console.debug("Attachment will no be created as it's not in view mode or the user is unauthorized to edit.");
    }
  } catch (e) {
    // Do not re-throw the error
    console.error("Error when creating attachment", e);

    // Improved error tracking with more detailed information
    let errorDetails: any = { message: e instanceof Error ? e.message : serializeError(e) };

    // Extract XHR details if available
    if (e.xhr) {
      errorDetails.xhr = {
        status: e.xhr.status,
        statusText: e.xhr.statusText
      };

      // Try to extract the full response text
      try {
        // For HTML responses, extract text content to avoid HTML tags
        if (e.xhr.responseText && e.xhr.responseText.includes('<!doctype html>')) {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = e.xhr.responseText;
          errorDetails.xhr.responseDetails = tempDiv.textContent?.substring(0, 500) || 'HTML response (extracted text)';
        } else {
          // For other responses, include the raw text
          errorDetails.xhr.responseDetails = e.xhr.responseText?.substring(0, 500) || 'No response text';
        }
      } catch (parseError) {
        errorDetails.xhr.responseDetails = 'Error parsing response: ' + parseError.message;
      }
    }

    // Track the error with enhanced details
    trackEvent(JSON.stringify(errorDetails), 'create_attachment' + diagramType, 'error');
  }
}

EventBus.$on('diagramLoaded', async (code: string, diagramType: DiagramType) => {
  setTimeout(async () => {
    await createAttachment(code, diagramType);
  }, 1500);
});

EventBus.$on('edit', async(params: any) => {
  const context = await initForgeContext();
  const macroUuid =
    forgeGlobal.forgeContext?.localId
    || context.extension?.config?.uuid
    || uuidv4();
  // Forward the macro's customContentId so the modal can load the right diagram
  // and the pre-edit paywall gate can fire. Without this the modal opens a blank
  // new diagram and the paywall check is skipped entirely.
  // Resolved (not a raw config read) so a pasted macro forwards its real id.
  const customContentId = resolveEffectiveCustomContentId(context);

  // In-viewer Edit gate (utils/guardEditClick.ts): when this macro's id is
  // shared by another macro on the page, saving from the modal forks a CC that
  // can never be linked back (writebackGate.ts / #170) — refuse BEFORE the
  // modal opens. Every viewer type now loads with the zero-network
  // 'cross-page-only' copy check, so the click is where same-page duplicates
  // are caught, for ALL types. The guard memoizes its page-ADF scan because
  // this shared-entry listener and each type's own 'edit' listener both fire
  // on one click.
  if (!(await guardEditClick({
    customContentId,
    macroType: (store.state.diagram?.diagramType as MacroTypeValue) || 'sequence',
  }))) return;

  const journeyId = startEditJourney(macroUuid, 'dialog');
  const journeyStartTime = getEditJourneyStartTime();
  
  await openModal({
    resource: 'main',
    onClose: () => {
      endEditJourney('cancelled');
      location.reload();
    },
    size: 'fullscreen',
    context: {
      macroMode: 'editor',
      ...(customContentId && { customContentId }),
      journey_id: journeyId,
      journey_start_time: journeyStartTime,
      macro_uuid: macroUuid,
      session_id: getOrCreateSession(),
      ...params
    },
  });
});


// Install the singleton "Restore unsaved changes" banner. It listens for
// 'draft-available' on EventBus and renders a fixed-position recovery card at the
// top of the page; each editor's mount logic emits the event on reopen.
import { installRestoreDraftBanner } from '@/utils/restoreDraftBanner';
import { resolveEffectiveCustomContentId } from '@/utils/effectiveCustomContentId';
import { diagnoseSaveFailure, GENERIC_SAVE_FAILED_MESSAGE } from '@/model/saveFailureDiagnosis';
installRestoreDraftBanner();

EventBus.$on('save', async () => {
  // Belt for the publishBlock backstop (model/editDupGate.ts): Publish is
  // disabled in Header.vue when set, but keyboard shortcuts / racy emits can
  // still reach here. Refuse outright rather than forking an unreferenced CC.
  if (store.state.publishBlock) {
    toast({ message: PUBLISH_BLOCK_MESSAGES[store.state.publishBlock], duration: 8000 });
    EventBus.$emit('save-error', new Error(`publish blocked: ${store.state.publishBlock}`));
    return;
  }
  // Start the publish-latency clock at the save-handler entry — EventBus.$emit
  // ('save') fires synchronously from the Publish click (Header.vue saveAndExit),
  // so this is effectively the click instant. Stopped at the redirect below.
  markPublishClicked();
  notifyAiTitleSaved({ title: store.state.diagram.title, contentId: store.state.diagram.id })

  const isNewSequence = !store.state.diagram.id && store.state.diagram.diagramType === "sequence"
  store.state.diagram.isNew = false;

  // Captured before save runs. After save, if the returned id differs from
  // sourceId, the save forked a new custom content (cross-page-copy / same-
  // page-duplicate path in CustomContentStorageProvider.save) and the macro
  // params must be rewritten via view.submit, else the page still points at
  // the source content while the new one sits orphaned.
  // The truthy-guard on sourceId is load-failure protection: a degraded load
  // (404/restricted custom content) mounts NULL_DIAGRAM with id=''; saves
  // there always return a new id, but writing it back would repoint the
  // macro at a blank new record.
  const sourceId = store.state.diagram.id ? String(store.state.diagram.id) : '';

  let id: string;
  try {
    id = await saveToPlatform(store.state.diagram);
  } catch (error) {
    const status = (error as any)?.status || (error as any)?.statusCode;
    const failureReason = error instanceof LegacyLoadBlockedSaveError
      ? 'legacy_load_blocked'
      : error instanceof InvalidSavedContentIdError
        ? 'invalid_saved_content_id'
        : status
          ? `http_${status}`
          : error instanceof Error
            ? error.name
            : 'unknown_error';
    trackEditorMutationLifecycleEvent('macro_save_failed', failureReason);
    // ZEN-1170 Defect 1: persistence layer refused save because the legacy
    // content-property load failed. Surface a clear message that does NOT
    // suggest "retry" (retrying won't help; the user needs to refresh or
    // contact support).
    // Release the Publish button's loading state — the dialog stays open for
    // retry, so the spinner must be cleared (Header.vue listens for this).
    EventBus.$emit('save-error', error);
    if (error instanceof LegacyLoadBlockedSaveError) {
      toast({
        message: 'Legacy diagram content failed to load — saving is disabled to prevent data loss. Please refresh the page or contact support.',
        duration: 8000,
      });
      return;
    }
    console.error('save failed', error);
    trackEvent('save_failed', 'save_failed', 'error', {
      error_message: String((error as any)?.message || error).substring(0, 500),
      http_status: (error as any)?.status || (error as any)?.statusCode || 'unknown',
      error_code: (error as any)?.code,
      error_shape: (error as any)?.errorShape,
      macro_type: store.state.diagram.diagramType as MacroTypeValue,
    });
    // A create-time 404 is probed once (save_failed_diagnosed) so the toast can
    // name a missing space permission instead of inviting a retry that cannot
    // succeed — see model/saveFailureDiagnosis.ts. Any other failure keeps the
    // generic copy; the dialog stays open either way.
    const message = await diagnoseSaveFailure(
      error,
      { surface: 'editor', macro_type: store.state.diagram.diagramType as MacroTypeValue },
      globals.apWrapper,
    );
    toast({ message, duration: message === GENERIC_SAVE_FAILED_MESSAGE ? 5000 : 12000 });
    // Do NOT close the dialog — let the user retry
    return;
  }

  const preservedTheme = sessionStorage.getItem(`${location.hostname}-preserve-zenuml-conf-theme`);
  if (isNewSequence && preservedTheme) {
    sessionStorage.removeItem(`${location.hostname}-preserve-zenuml-conf-theme`);
    localStorage.setItem(`${location.hostname}-${id}-zenuml-conf-theme`, preservedTheme);
  }

  // End journey on save
  if (getEditJourneyId()) {
    endEditJourney('saved');
  }

  // #212: create the diagram-backup attachment deterministically at SAVE time,
  // rather than relying on a later display-mode view firing. Production data
  // showed ~33% of created macros never trigger a qualifying view, so their
  // backup PNG is never generated and PDF/Word export later fails with
  // attachment_not_found. At save the user has write permission (no 403) and the
  // content is known, so we can write it directly.
  //
  // Scope: the zenuml-sequence-macro family (sequence/mermaid/plantuml) only —
  // it's the one editor with a capturable preview (.screen-capture-content).
  // graph/openapi editors have no diagram to snapshot here (tracked separately).
  //
  // Fail-safe + time-boxed: a backup is best-effort and must NEVER break or hang
  // the publish. Runs before view.submit (which tears down the iframe). If it
  // exceeds the cap or throws, we proceed to submit anyway — the view-time path
  // remains as a backfill.
  const savedDiagramType = store.state.diagram.diagramType;
  if (id && (savedDiagramType === 'sequence' || savedDiagramType === 'mermaid' || savedDiagramType === 'plantuml')) {
    try {
      const createAttachmentIfContentChanged = await createAttachmentIfContentChangedPromise;
      await Promise.race([
        createAttachmentIfContentChanged(store.state.diagram.code ?? '', savedDiagramType, {
          customContentId: String(id),
          fromSave: true,
        }),
        // With fromSave the slow Confluence write now runs server-side (the
        // backend acks after validation and finishes in waitUntil — see
        // Attachment.uploadAttachmentViaApp async mode + functions/forge-upload-
        // attachment.ts). So this await only bounds the client-side PNG capture
        // + a fast backend ack (~1.5–3.5s), not the full upload. The cap is a
        // hang-guard for a wedged capture; 6s is generous headroom.
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('save-attachment timeout')), 6000)),
      ]);
    } catch (e) {
      console.warn('save-time attachment creation skipped (non-fatal):', (e as Error)?.message ?? e);
    }
  }

  // Writeback signal derivation: see deriveWritebackSignals in @/model/writebackGate.

  // Run the writeback + close immediately — no artificial delay. The 500ms
  // buffer here used to exist "to give trackEvents time to send", but the
  // save-time attachment step above already awaits ~1.5–3.5s (capture + ack),
  // which is more than enough for the earlier trackEvents to flush; adding
  // another 500ms of dead time to every publish isn't worth it.
  void (async () => {
    // Writeback the new customContentId when (a) inserting a fresh macro,
    // (b) the save returned a different id (cross-page-copy / same-page-
    // duplicate POST branch), (c) we recovered from an orphan and must
    // repoint the macro at the recovered sibling id, or (d) we migrated a
    // legacy uuid-only macro and must write customContentId for the first time.
    const [inserting, configuring] = await Promise.all([isInserting(), isConfiguring()]);
    // #170: never view.submit in a non-submittable surface — see writebackGate.ts.
    const { attemptRepair, attemptLegacyMigration, needsWriteback } = decideWriteback(
      deriveWritebackSignals({
        sourceId,
        newId: id,
        originalCustomContentId,
        docSource: store.state.diagram?.source,
        recoveredFromOrphan: !!(store.state.diagram as any)?.recoveredFromOrphan,
        inserting,
        configuring,
      })
    );
    // A save that produced an id but cannot bind it leaves an orphaned custom
    // content behind and a macro that still renders empty — the failure mode
    // paste-to-create hit on lite-stg. Record the surface signals so the cause
    // is visible without a browser: `firstBind` is now handled, so anything
    // reaching here is a non-submittable surface.
    //
    // The byline editor is EXCLUDED: it is a designed unbound-save surface —
    // the saved diagram is handed back as a paste link, there is no macro to
    // bind — so every byline create would otherwise fire this warn and, once
    // the byline rolls out, drown the defect signal the event instruments in
    // designed-behaviour noise. The editor modal the byline opens carries the
    // byline's own moduleKey (see the isSequenceFamilyEntry note above).
    const fromByline =
      (forgeGlobal.forgeContext as any)?.moduleKey === 'zenuml-byline-diagrams';
    if (!!id && !sourceId && !originalCustomContentId && !needsWriteback && !fromByline) {
      trackEvent('', 'writeback_unbound_first_save', 'warn', {
        inserting: !!inserting,
        configuring: !!configuring,
        custom_content_id: String(id),
      });
    }
    // Redirect starts now (view.submit / view.close below). Stop the
    // publish-latency clock here so it captures the full user-perceived wait.
    trackPublishCompleted({
      macro_type: store.state.diagram.diagramType as MacroTypeValue,
      operation_mode: inserting ? 'create' : 'edit',
      content_id: String(id),
      custom_content_id: String(id),
    });
    try {
      if (needsWriteback && !isValidCustomContentId(id)) {
        // conf-app#320 defense-in-depth: never write a garbage customContentId
        // into the macro config. saveToPlatform should have thrown already;
        // close without persisting the bad id rather than orphaning the macro.
        trackEvent('save_failed', 'writeback_skipped_invalid_id', 'error', {
          new_custom_content_id: String(id),
          macro_type: store.state.diagram.diagramType as MacroTypeValue,
        });
        await (await getView()).close();
      } else if (needsWriteback) {
        await (await getView()).submit({config: {
          customContentId: id,
          updatedAt: new Date().toISOString(),
          ...(originalConfigUuid && { uuid: originalConfigUuid }),
        }});
        if (attemptRepair && originalCustomContentId) {
          reportOrphanMacroRepaired(recoveryPageId, originalCustomContentId, id, 'sequence');
        }
        if (attemptLegacyMigration && originalConfigUuid) {
          reportLegacyContentPropertyMacroRepaired('sequence', originalConfigUuid, id, { pageId: recoveryPageId });
        }
      } else {
        await (await getView()).close();
      }
      // Only clear the local draft after the macro state is durable on the
      // page. If view.submit throws below, the backend POST has succeeded
      // but the macro still points at the source content; keeping the draft
      // around preserves the user's recovery anchor for a retry.
      EventBus.$emit('saved', id);
    } catch (error) {
      // view.submit throws on MACRO_NOT_FOUND etc. The backend POST already
      // succeeded, so without writeback the page still points at the source
      // content; surface this as a save_failed signal so we can detect it.
      // The 'saved' event is intentionally NOT emitted here so the local
      // draft survives as a retry anchor.
      console.error('view.submit/close failed after save', error);
      // The dialog didn't close — release the Publish button (Header.vue).
      EventBus.$emit('save-error', error);
      trackEvent('save_failed', 'view_submit_failed', 'error', {
        error_message: String((error as any)?.message || error).substring(0, 500),
        new_custom_content_id: id,
        writeback_required: String(needsWriteback),
        macro_type: store.state.diagram.diagramType as MacroTypeValue,
      });
    }
  })();
});

EventBus.$on('exit', async (showWarning: boolean) => {
  // Prepare event data
  const isNewSequence = !store.state.diagram.id && store.state.diagram.diagramType === DiagramType.Sequence;
  const elapsedTimeMs = Date.now() - editorStartTime;
  
  const eventProps = {
    had_changes: showWarning,
    source: 'editor',
    elapsed_time_ms: elapsedTimeMs,
    code_length: store.state.diagram.code?.length || 0,
    journey_id: getEditJourneyId(),
    session_id: getOrCreateSession(),
  };
  
  if (showWarning) {
    // Show custom modal dialog for Forge
    const result = await showCloseWithoutSavingDialog();
    
    if (result === 'discard') {
      // User confirmed exit - track exit event
      const exitEventAction = isNewSequence ? 'create_macro_exit' : 'edit_macro_exit';
      trackEvent('', exitEventAction, DiagramType.Sequence, eventProps);
      trackEditorMutationLifecycleEvent('macro_edit_cancelled');
      
      // End journey on exit
      if (getEditJourneyId()) {
        endEditJourney('cancelled');
      }
      
      await (await getView()).close();
    } else {
      // User cancelled exit (chose to keep editing) - track cancelled event
      const cancelledEventAction = isNewSequence ? 'create_macro_exit_cancelled' : 'edit_macro_exit_cancelled';
      trackEvent('', cancelledEventAction, DiagramType.Sequence, eventProps);
      // Do NOT end journey - user continues editing
    }
  } else {
    // No changes - immediate exit
    const exitEventAction = isNewSequence ? 'create_macro_exit' : 'edit_macro_exit';
    trackEvent('', exitEventAction, DiagramType.Sequence, eventProps);
    
    // End journey on exit
    if (getEditJourneyId()) {
      endEditJourney('window_close');
    }
    
    await (await getView()).close();
  }
});



EventBus.$on('fullscreen', async () => {
  const context = await initForgeContext();
  const macroUuid =
    forgeGlobal.forgeContext?.localId
    || context.extension?.config?.uuid
    || uuidv4();

  await openModal({
    resource: 'main',
    onClose: () => {
      location.reload();
    },
    size: 'fullscreen',
    context: {
      macroMode: 'fullscreen',
      macro_uuid: macroUuid,
      session_id: getOrCreateSession(),
    },
  });
});

EventBus.$on('updateContent', async (diagram: Diagram) => {
  if (await globals.apWrapper.canUserEdit()) {
    // ZEN-1170 Defect 1: catch the legacy-load-blocked refusal locally so it
    // doesn't surface as an unhandled rejection. Autosave paths must stay
    // silent when refused — the user sees the toast surfaced by the explicit
    // 'save' handler if they try to save manually.
    saveToPlatform(diagram).catch((error) => {
      if (error instanceof LegacyLoadBlockedSaveError) {
        console.debug('updateContent save refused: legacy load blocked');
        return;
      }
      // conf-app#320: the persistence layer now throws when a save returns no
      // usable id. Autosave must stay silent — the explicit 'save' handler
      // surfaces the retry toast — so swallow it rather than raising an
      // unhandled rejection. The macro config is never written from autosave.
      if (error instanceof InvalidSavedContentIdError) {
        console.debug('updateContent save produced no usable customContentId; skipping');
        return;
      }
      throw error;
    });
  } else {
    console.info('Your changes cannot be persistent as you are not authorized to edit.');
  }
});
