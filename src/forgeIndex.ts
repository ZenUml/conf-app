import globals from '@/model/globals';
import forgeGlobal, { getView, getContext as initForgeContext, isEditorMode, openModal, isInserting, isConfiguring, isFullscreenMode } from '@/model/globals/forgeGlobal';
import EventBus from './EventBus'
import {trackEvent, serializeError} from "@/utils/window";
import { toast } from '@/utils/toast';
import {Diagram, DiagramType} from "@/model/Diagram/Diagram";
import { decideWriteback } from "@/model/writebackGate";
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
import { isPrefetchDue } from '@/utils/prefetch/throttle';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { notifyAiTitleSaved } from '@/composables/useAutoTitle';
import { handleCreateDemoPageRoute } from './routes/createDemoPage';
import { type MacroTypeValue } from '@/utils/analytics/catalog';
import { NULL_DIAGRAM, DataSource } from '@/model/Diagram/Diagram';
import { reportOrphanObserved, reportOrphanMacroRepaired } from '@/utils/orphanTelemetry';
import { isValidCustomContentId } from '@/utils/customContentId';
import {
  reportLegacyContentPropertyRestored,
  reportLegacyContentPropertyLoadFailed,
  reportLegacyContentPropertyValueUnexpected,
  reportLegacyContentPropertyMacroRepaired,
} from '@/utils/legacyContentPropertyTelemetry';
import { LegacyLoadBlockedSaveError, InvalidSavedContentIdError } from '@/model/ContentProvider/Persistence';
import * as renderPerf from '@/utils/analytics/renderPerf';

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

  // Hide skeleton loader after critical content is loaded
  const hideSkeletonLoader = () => {
    const skeletonLoader = document.getElementById('skeleton-loader');
    if (skeletonLoader) {
      skeletonLoader.style.display = 'none';
    }
  };

  try {
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

    // Check if this is a content byline item route (AI Aide)
    if (!isOpenedModal && context.extension?.type === 'confluence:contentBylineItem') {
      await handleAiAideRoute();
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
    if ((context as any).moduleKey === 'zenuml-page-banner') {
      // Phase 5a measurement: detect whether the current user is a space admin
      // and, when so, fire `space_admin_active`. Runs on EVERY page-banner load
      // (including loads where no banner shows) so we observe admin activity
      // across Confluence, not just on our macros. Lite-only and throttled to
      // once / 30 days per domain:space, so the common load exits synchronously
      // before any init/REST. Awaited before view.close() — closing the iframe
      // would abort the in-flight REST call — and never throws.
      await maybeProbeSpaceAdmin();

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
  } catch (error) {
    console.error('Error in critical path initialization:', error);
    hideSkeletonLoader(); // Hide skeleton even on error
    throw error;
  }
}

// Load heavy components asynchronously
async function loadHeavyComponents(criticalData: { macroData: any }) {
  try {
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
        ['confluence:globalSettings', 'confluence:globalPage', 'confluence:contentBylineItem', 'confluence:spacePage'].includes(context.extension?.type)) ||
      (context as any).moduleKey === 'zenuml-page-banner'
    ) {
      console.log('Skipping heavy components load for global context');
      return;
    }

    // Paywall page-banner targeting write. Every macro render (viewer OR editor,
    // any diagram type) refreshes the per-space localStorage marker that the
    // global page-banner iframe reads on a LATER page load. This is the ONLY
    // write path: the editor's paywall gate also calls initialize(), but plain
    // viewer page loads never would — and reaching the user BEFORE they open the
    // editor is the whole point of the redesign. Fire-and-forget and Lite-gated
    // (the composable no-ops the write for Full/Diagramly) so it never blocks or
    // breaks the render.
    if (globals.apWrapper.isLite()) {
      import('@/composables/useCustomerSuccessService')
        .then(({ useCustomerSuccessService }) => useCustomerSuccessService().initialize())
        .catch(e => console.warn('[paywall-banner] targeting refresh failed', e));
    }

    let doc: Diagram | undefined;
    let legacyLoadBlocked = false;
    const customContentId = context.extension?.config?.customContentId || context.extension.modal?.customContentId;
    originalCustomContentId = customContentId;
    recoveryPageId = context.extension?.content?.id;
    // ZEN-1170 Defect 1: see forge-graph-editor.ts for why this uses
    // config.uuid and not forgeGlobal.localId.
    const storageUuid: string | undefined = context.extension?.config?.uuid;
    if (customContentId) {
      const loaded = await renderPerf.time('fetch', () =>
        globals.apWrapper.loadCustomContentWithOrphanRecovery(recoveryPageId, customContentId));
      console.debug('Loaded custom content', loaded.customContent, 'recoveredFromOrphan?', loaded.recoveredFromOrphanId);
      doc = loaded.customContent?.value;
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
      }
    }

    // ZEN-1170 Defect 1: try the legacy content-property fallback whenever
    // the custom-content path didn't yield a doc AND a legacy storageUuid
    // exists. Covers both pure-legacy macros (no customContentId) AND mixed-
    // state macros (stale customContentId that 404s, but the original legacy
    // body still lives on the page). Without this, a mixed-state macro
    // mounts the example DSL and a save would replace the legacy body.
    if (!doc && storageUuid) {
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
    if (!doc && storageUuid) {
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

    // ZEN-1170 (pre-Defect-1 behavior preserved): when CC was attempted but
    // failed AND we have no legacy storageUuid to try AND legacy fallback
    // wasn't blocked, mount the placeholder empty doc so the wipe-precursor
    // telemetry + per-macro-type dispatch below can run.
    // CRITICAL: gate on !legacyLoadBlocked. If the legacy fallback set the
    // sentinel (e.g. mixed-state with 403/5xx on the property read), the
    // blocked-doc branch below MUST be the one that runs — otherwise the
    // placeholder NULL_DIAGRAM would erase the sentinel and persistence
    // would happily save an empty doc over the legacy body.
    if (!doc && customContentId && !legacyLoadBlocked) {
      doc = { ...NULL_DIAGRAM };
    }
    if (!doc) {
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

    // Backfill default PlantUML DSL for existing diagrams created before PlantUML support
    if (!doc.plantUmlCode) {
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

    // Hide skeleton loader before mounting the actual content
    const skeletonLoader = document.getElementById('skeleton-loader');
    if (skeletonLoader) {
      skeletonLoader.style.display = 'none';
    }

    const isSequence = context.moduleKey.startsWith('zenuml-sequence-macro') || context.moduleKey.startsWith('gpt-diagram-macro') || context.extension.modal?.diagramType === 'sequence' || context.extension.modal?.diagramType === 'mermaid';
    const isGraph = context.moduleKey.startsWith('zenuml-graph-macro');
    const isEmbed = context.moduleKey.startsWith('zenuml-embed-macro');
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

    if(isSequence) {
      const macroKind = (doc?.diagramType === DiagramType.Mermaid || context.extension.modal?.diagramType === 'mermaid') ? 'mermaid' : 'sequence';
      const fullscreenMode = await isFullscreenMode();

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

      //@ts-ignore
      mountRoot(doc, component, { autoResize: !editable && !fullscreenMode });

      if (editable) {
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
          trackAnalyticsEvent("macro_edit_opened", {
            feature_area: "macro",
            surface: "editor",
            macro_type: macroType,
            entry_point: "macro_toolbar",
          });
        }
      }
    } else if(isGraph) {
      await import(editable ? "@/forge-graph-editor" : "@/forge-graph-viewer");
    } else if(isEmbed) {
      await import(editable ? "@/forge-embed-editor" : "@/forge-embed-viewer");
    } else if(isAsyncApi && import.meta.env.PRODUCT_TYPE === 'asyncapi') {
      // Build-time literal: Vite replaces PRODUCT_TYPE via `define` so
      // non-asyncapi variants short-circuit and dead-code-eliminate the
      // dynamic import. Keeps @asyncapi/parser (which pulls in Node `fs`)
      // out of the lite/full/diagramly dependency graph entirely.
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

  } catch (error) {
    console.error('Error loading heavy components:', error);
    // Hide skeleton loader even on error
    const skeletonLoader = document.getElementById('skeleton-loader');
    if (skeletonLoader) {
      skeletonLoader.style.display = 'none';
    }
    throw error;
  }
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
  const customContentId = context.extension?.config?.customContentId;
  const journeyId = startEditJourney(macroUuid, 'dialog');
  const journeyStartTime = getEditJourneyStartTime();
  
  await openModal({
    resource: 'main',
    onClose: (payload: any) => {
      console.log('onClose called with', payload);
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
// 'draft-available' on EventBus and renders a fixed-position banner at the
// top of the page; each editor's mount logic emits the event on reopen.
import { installRestoreDraftBanner } from '@/utils/restoreDraftBanner';
installRestoreDraftBanner();

EventBus.$on('save', async () => {
  notifyAiTitleSaved({ title: store.state.diagram.title, contentId: store.state.diagram.id })
  console.log('save', store.state.diagram);

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
      macro_type: store.state.diagram.diagramType as MacroTypeValue,
    });
    toast({ message: 'Failed to save. Please try again.', duration: 5000 });
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
        // Cap chosen to actually AWAIT the upload (render + POST + properties PUT
        // ~2–5s on staging) so it completes before view.submit tears down the
        // iframe. A 2.5s cap abandoned the await early and risked aborting the
        // in-flight write (verified on lite-stg: the create finished ~just after
        // a 2.5s race fired).
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('save-attachment timeout')), 8000)),
      ]);
    } catch (e) {
      console.warn('save-time attachment creation skipped (non-fatal):', (e as Error)?.message ?? e);
    }
  }

  // ZEN-1170 Defect 2b: repair stale macro XML when we saved against the
  // recovered sibling id. view.submit({config:...}) only persists back to
  // the macro XML in surfaces where the parent is the macro-config editor —
  // i.e. inserting a new macro or editing via the in-page "edit macro params"
  // affordance (isConfiguring). In viewer-launched modals the submitted
  // payload is forwarded to onClose and discarded, so repair would be a
  // no-op and the telemetry event would be misleading. Gate accordingly.
  const macroNeedsRepair = !!(originalCustomContentId && id && id !== originalCustomContentId);
  // ZEN-1170 Defect 1: legacy migration writeback. See forge-graph-editor.ts
  // for the rationale — detect via source rather than a parallel flag, so we
  // reuse Defect 2b's writeback path without adding new Diagram fields.
  const legacyMacroNeedsRepair = !originalCustomContentId
    && (store.state.diagram?.source === DataSource.ContentProperty
        || store.state.diagram?.source === DataSource.ContentPropertyOld
        // PR #139 same-page recovery — see forge-graph-editor.ts for the
        // full rationale. Cross-page recovery already writes back via the
        // idChanged path; this branch only fires when the recovered CC
        // lives on the same page so save updates in place (idChanged=false).
        || (store.state.diagram?.source === DataSource.CustomContent
            && !!(store.state.diagram as any)?.recoveredFromOrphan));

  // Give some time for track event to be sent out. We are not using a more reliable way to track event because
  // we don't want to block dialog close for too long.
  setTimeout(async () => {
    // Writeback the new customContentId when (a) inserting a fresh macro,
    // (b) the save returned a different id (cross-page-copy / same-page-
    // duplicate POST branch), (c) we recovered from an orphan and must
    // repoint the macro at the recovered sibling id, or (d) we migrated a
    // legacy uuid-only macro and must write customContentId for the first time.
    const [inserting, configuring] = await Promise.all([isInserting(), isConfiguring()]);
    const idChanged = !!sourceId && !!id && id !== sourceId;
    // #170: never view.submit in a non-submittable surface — see writebackGate.ts.
    const { attemptRepair, attemptLegacyMigration, needsWriteback } = decideWriteback({
      inserting: !!inserting,
      configuring: !!configuring,
      idChanged,
      macroNeedsRepair,
      legacyMacroNeedsRepair,
      hasId: !!id,
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
  }, 500);
});

EventBus.$on('exit', async (showWarning: boolean) => {
  console.log('exit', showWarning);
  
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
    onClose: (payload: any) => {
      console.log('onClose called with', payload);
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
