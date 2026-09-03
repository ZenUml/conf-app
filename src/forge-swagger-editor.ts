import SwaggerEditorBundle from 'swagger-editor'
import "swagger-editor/dist/swagger-editor.css";
import "./assets/swagger-editor.css";
import SpecListener from './utils/spec-listener'

import React from 'react';
import ReactDOM from 'react-dom';
import SwaggerEditor from "@/components/react/SwaggerEditor";
// @ts-ignore
import './assets/tailwind.css'

import OpenApiExample from '@/model/OpenApi/OpenApiExample'
import './utils/IgnoreEsc'
import { Diagram, DiagramType, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import { openDocument } from '@/utils/documentOpening/openDocument';
import { buildOpenApiEditorTarget } from '@/utils/documentOpening/targets/openApiTarget';
import { saveToPlatform, LegacyLoadBlockedSaveError } from "@/model/ContentProvider/Persistence";
import { diagnoseSaveFailure, GENERIC_SAVE_FAILED_MESSAGE } from "@/model/saveFailureDiagnosis";
import globals from "@/model/globals";
import MacroUtil from "@/model/MacroUtil";
import { trackEvent } from '@/utils/window';
import { toast } from '@/utils/toast';
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { markPublishClicked, trackPublishCompleted } from "@/utils/analytics/publishTiming";
import forgeGlobal, { getView, getContext as initForgeContext, isInserting, isConfiguring } from '@/model/globals/forgeGlobal';
import EventBus from './EventBus';
import store from "@/model/store2";
import { showCloseWithoutSavingDialog } from './utils/modalService';
import { startEditJourney, endEditJourney, getOrCreateSession, getEditJourneyId, continueEditJourney } from '@/utils/journeyTracking';
import uuidv4 from '@/utils/uuid';
import { createApp } from 'vue';
import SyntaxErrorBox from "@/components/SyntaxErrorBox.vue";
import { validateOpenApiSpecForStore } from '@/utils/openapi/validate';
import { debounce } from 'lodash';
import { tryPageEditorPaywall } from '@/utils/paywall/mountPaywallGate';
import { installRestoreDraftBanner } from '@/utils/restoreDraftBanner';
import { reportOrphanMacroRepaired } from '@/utils/orphanTelemetry';
import { isValidCustomContentId } from '@/utils/customContentId';
import { decideWriteback, deriveWritebackSignals } from "@/model/writebackGate";

installRestoreDraftBanner();
import SwaggerForgeEditorShell from '@/components/OpenApi/SwaggerForgeEditorShell.vue';
import { resolveEffectiveCustomContentId } from '@/utils/effectiveCustomContentId';
import {
  buildOpenApiSaveDiagram,
  createOpenApiEditorState,
} from '@/model/OpenApi/OpenApiEditorState';
import { notifyAiTitleSaved } from '@/composables/useAutoTitle';

// Captured at editor open from extension.config.uuid; forwarded back through
// view.submit's replace-semantics so Connect-era guestParams.uuid survives.
let originalConfigUuid: string | undefined;

// ZEN-1170 Defect 2b: captured at editor open so the save callback can detect
// when the persisted id differs from the macro's stale config id and repair
// the macro XML via view.submit({config:...}).
//
// Captured from OpenedDocument.origin once mountEditorDocument's
// openDocument() call resolves (Slice 1 of the content-opening
// unification) — replaces the old module-scope originalCustomContentId /
// recoveryPageId variables the save handler used to read directly.
let capturedOrigin: { originalCustomContentId?: string; recoveryPageId?: string; recoveredFromOrphan: boolean } =
  { recoveredFromOrphan: false };
// True when this editor was opened from the "My API Documents" dashboard's Edit
// action — a standalone modal carrying the id via modal.customContentId, with no
// macro on the dashboard space page. On that path the shared loader
// false-positives isCopy=true, so the save must pin the id + clear isCopy to
// update in place. Mirrors the AsyncAPI editor's isDashboardEdit/pinToId guard.
let isDashboardEdit = false;
// Only pin the save when the target doc genuinely loaded with content. If the
// load failed (transient API error), leave this false so the save takes the
// normal copy-aware path and forks a new doc, rather than pinning + overwriting
// the real document with a blank OpenApiExample template.
let dashboardEditDocLoaded = false;

const debouncedValidateOpenApi = debounce(async (spec: string) => {
  if (!spec) {
    store.dispatch('updateError', null);
    return;
  }
  await validateOpenApiSpecForStore(spec, store, 'updateError');
}, 1000);

// Track editor session start time
const editorStartTime = Date.now();

let swaggerReactMounted = false;
let openApiDocumentHydrated = false;

function bootstrapSwaggerUi(mountEl: HTMLElement | null) {
  if (!mountEl) {
    console.error('OpenAPI editor: missing DOM mount element');
    return;
  }
  if (swaggerReactMounted) {
    return;
  }
  swaggerReactMounted = true;

  ReactDOM.render(
    React.createElement(SwaggerEditor as any, { saveAndExit: saveOpenApiAndExit, exit: exit }),
    mountEl,
  );

  const editor = SwaggerEditorBundle({
    dom_id: '#swagger-editor',
    presets: [],
    plugins: [SpecListener],
  });

  // eslint-disable-next-line
  // @ts-ignore
  window.editor = editor;
}

async function saveOpenApiAndExit() {
  // Start the publish-latency clock at the save-handler entry (≈ the Publish
  // click in react/Header.tsx). Stopped at the redirect below.
  markPublishClicked();
  const code = window.specContent;
  // Dashboard Edit: force an in-place update. CustomContentStorageProvider.save
  // only updates when (id && !isCopy); the dashboard space page false-positives
  // isCopy=true, which would otherwise fork a new doc ("editing made a new
  // diagram"). Pin the known id and clear isCopy — the same guard
  // buildAsyncApiSaveDiagram applies via pinToId for AsyncAPI dashboard edits.
  // Gated on dashboardEditDocLoaded so a failed load can't pin + overwrite.
  const diagram = buildOpenApiSaveDiagram({
    existing: window.diagram,
    spec: code,
    pinToId: isDashboardEdit && dashboardEditDocLoaded
      ? capturedOrigin.originalCustomContentId
      : undefined,
  });
  // @ts-ignore
  window.diagram = Object.assign(window.diagram || {}, diagram);

  // Record acceptance while the shared AI-title state still identifies this
  // as an unmodified generated suggestion. Mirrors the sequence/graph saves.
  notifyAiTitleSaved({
    title: window.diagram?.title,
    contentId: window.diagram?.id,
  });

  // Captured before save. If the returned id differs from sourceId, the save
  // forked a new custom content (cross-page-copy / same-page-duplicate path)
  // and the macro params must be rewritten via view.submit, else the page
  // still points at the source content while the new one sits orphaned.
  // The truthy-guard is load-failure protection (NULL_DIAGRAM fallback).
  // @ts-ignore
  const sourceId = window.diagram?.id ? String(window.diagram.id) : '';

  let id: string;
  try {
    // @ts-ignore
    id = await saveToPlatform(window.diagram);
  } catch (error) {
    // Persistence layer refused save because the direct fetch came back
    // indeterminate (forbidden/5xx/malformed) rather than a confirmed
    // absence — content may still exist, unverified. Retry won't help until
    // that's resolved — direct the user to refresh / contact support instead
    // (mirrors forge-graph-editor.ts's own LegacyLoadBlockedSaveError handling,
    // with wording accurate to OpenAPI, which never used legacy content
    // properties — see openApiTarget.ts).
    if (error instanceof LegacyLoadBlockedSaveError) {
      toast({
        message: "This diagram's content couldn't be verified — saving is disabled to prevent data loss. Please refresh the page or contact support.",
        duration: 8000,
      });
      EventBus.$emit('save-error', error);
      return;
    }
    console.error('saveOpenApiAndExit failed', error);
    // Release the Publish button — editor stays open for retry (react/Header.tsx).
    EventBus.$emit('save-error', error);
    trackEvent('save_failed', 'save_failed', 'error', {
      error_message: String((error as any)?.message || error).substring(0, 500),
      http_status: (error as any)?.status || (error as any)?.statusCode || 'unknown',
      error_code: (error as any)?.code,
      error_shape: (error as any)?.errorShape,
    });
    // A create-time 404 is probed once (save_failed_diagnosed) so the toast can
    // name a missing space permission instead of inviting a retry that cannot
    // succeed — see model/saveFailureDiagnosis.ts.
    const message = await diagnoseSaveFailure(error, { surface: 'editor', macro_type: 'openapi' }, globals.apWrapper);
    toast({ message, duration: message === GENERIC_SAVE_FAILED_MESSAGE ? 5000 : 12000 });
    // Do NOT end journey, do NOT close — keep editor open so the user can retry.
    return;
  }
  // End journey on save
  if (getEditJourneyId()) {
    endEditJourney('saved');
  }

  // Capture derivation inputs now — window.diagram may move under the
  // deferred writeback below.
  const derivationInput = {
    sourceId,
    newId: id,
    originalCustomContentId: capturedOrigin.originalCustomContentId,
    // @ts-ignore
    docSource: window.diagram?.source,
    recoveredFromOrphan: capturedOrigin.recoveredFromOrphan,
  };

  /* eslint-disable no-undef */
  setTimeout(async () => {
    const [inserting, configuring] = await Promise.all([isInserting(), isConfiguring()]);
    const { attemptRepair, needsWriteback } = decideWriteback(
      deriveWritebackSignals({ ...derivationInput, inserting, configuring })
    );
    // Redirect starts now (view.submit / view.close below). Stop the clock.
    trackPublishCompleted({
      macro_type: 'openapi',
      operation_mode: inserting ? 'create' : 'edit',
      content_id: String(id),
      custom_content_id: String(id),
    });
    try {
      if (needsWriteback && !isValidCustomContentId(id)) {
        // conf-app#320 defense-in-depth: never write a garbage customContentId
        // ("undefined"/"null"/non-numeric) into the macro config — that is the
        // exact state that permanently orphans a macro. saveToPlatform should
        // have thrown already; if we somehow got here, close without persisting
        // the bad id rather than stamping it.
        trackEvent('save_failed', 'writeback_skipped_invalid_id', 'error', {
          new_custom_content_id: String(id),
          macro_type: 'openapi',
        });
        await (await getView()).close();
      } else if (needsWriteback) {
        await (await getView()).submit({config: {
          customContentId: id,
          updatedAt: new Date().toISOString(),
          ...(originalConfigUuid && { uuid: originalConfigUuid }),
        }});
        if (attemptRepair && capturedOrigin.originalCustomContentId) {
          reportOrphanMacroRepaired(capturedOrigin.recoveryPageId, capturedOrigin.originalCustomContentId, id, 'openapi');
        }
      } else {
        await (await getView()).close();
      }
      // Notify draft listeners (react/Header.tsx subscribes to 'saved')
      // only after the macro state is durable. If submit throws below, the
      // local draft survives as a retry anchor.
      EventBus.$emit('saved', id);
    } catch (error) {
      console.error('view.submit/close failed after openapi save', error);
      // Dialog didn't close — release the Publish button (react/Header.tsx).
      EventBus.$emit('save-error', error);
      trackEvent('save_failed', 'view_submit_failed', 'error', {
        error_message: String((error as any)?.message || error).substring(0, 500),
        new_custom_content_id: id,
        writeback_required: String(needsWriteback),
        macro_type: 'openapi',
      });
    }
  }, 500);
}

async function exit() {
  const codeChanged = window.diagram?.code !== window.specContent;
  
  // Prepare event data
  const isNewOpenApi = !store.state.diagram.id && store.state.diagram.diagramType === DiagramType.OpenApi;
  const elapsedTimeMs = Date.now() - editorStartTime;
  
  const eventProps = {
    had_changes: codeChanged,
    source: 'swagger_editor',
    elapsed_time_ms: elapsedTimeMs,
    code_length: store.state.diagram.code?.length || 0,
    journey_id: getEditJourneyId(),
    session_id: getOrCreateSession(),
  };
  
  if (codeChanged) {
    // Show custom modal dialog for Forge
    const result = await showCloseWithoutSavingDialog();
    
    if (result === 'discard') {
      // User confirmed exit - track exit event
      const exitEventAction = isNewOpenApi ? 'create_macro_exit' : 'edit_macro_exit';
      trackEvent('', exitEventAction, DiagramType.OpenApi, eventProps);
      
      // End journey on exit
      if (getEditJourneyId()) {
        endEditJourney('cancelled');
      }
      
      await (await getView()).close();
    } else {
      // User cancelled exit (chose to keep editing) - track cancelled event
      const cancelledEventAction = isNewOpenApi ? 'create_macro_exit_cancelled' : 'edit_macro_exit_cancelled';
      trackEvent('', cancelledEventAction, DiagramType.OpenApi, eventProps);
      // Do NOT end journey - user continues editing
    }
  } else {
    // No changes - immediate exit
    const exitEventAction = isNewOpenApi ? 'create_macro_exit' : 'edit_macro_exit';
    trackEvent('', exitEventAction, DiagramType.OpenApi, eventProps);
    
    // End journey on exit
    if (getEditJourneyId()) {
      endEditJourney('window_close');
    }
    
    await (await getView()).close();
  }
}

async function initializeMacro() {
  const context = await initForgeContext();

  originalConfigUuid = context.extension?.config?.uuid;

  // Start journey tracking
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
  // Read customContentId from extension.config (macro / page-editor context) AND
  // extension.modal (the dashboard's Edit / View flow).
  //
  // ZEN-1170 (2026-05-23) removed the modal fallback because, at that time,
  // OpenAPI had no dashboard — the only modal was the page-macro viewer, where
  // config.customContentId always resolved. The dual-format dashboard
  // reintroduces a dashboard Edit that opens THIS editor as a standalone modal
  // carrying the id via modal.customContentId, so the fallback is required
  // again. saveOpenApiAndExit pins the save for that path (see isDashboardEdit).
  // configContentId stays a RAW config read: isDashboardEdit means "no config,
  // came in through the modal", so it must not see any fallback. The pasted
  // deeplink is folded into customContentId only — a pasted OpenAPI macro is a
  // page macro, not a dashboard edit.
  const configContentId = context.extension?.config?.customContentId;
  const modalContentId = context.extension?.modal?.customContentId;
  const customContentId = resolveEffectiveCustomContentId(context);
  isDashboardEdit = !configContentId && !!modalContentId;
  // Passed to openDocument() below as `pageId`; the resolved id/recovery
  // origin it feeds back is captured into `capturedOrigin`, not this const.
  const recoveryPageId = context.extension?.content?.id;
  if (isDashboardEdit) {
    // Volume signal for the dashboard-edit path. Was a regression detector when
    // the modal fallback was treated as a bug; now it measures the intended
    // dashboard route.
    trackAnalyticsEvent('swagger_editor_config_empty_with_modal', {
      feature_area: 'macro',
      surface: 'editor',
      macro_type: 'openapi',
      content_id: String(modalContentId),
    });
  }

  const mountEditorDocument = async () => {
    if (openApiDocumentHydrated) {
      return;
    }
    openApiDocumentHydrated = true;

    const outcome = await openDocument({
      policy: 'write',
      context,
      pageId: recoveryPageId,
      target: buildOpenApiEditorTarget(),
    });

    let doc: Diagram | undefined;
    if (outcome.kind === 'opened') {
      doc = outcome.document.doc;
      capturedOrigin = {
        originalCustomContentId: outcome.document.origin.originalCustomContentId,
        recoveryPageId: outcome.document.origin.recoveryPageId,
        recoveredFromOrphan: outcome.document.origin.recoveredFromOrphan,
      };
    } else if (outcome.error.indeterminate) {
      // An id existed but the failure was indeterminate (forbidden/5xx/
      // malformed on the direct fetch) — content may still exist, just
      // unverifiable right now. Data-integrity guard: mount NULL_DIAGRAM
      // with legacyLoadBlocked set so saveToPlatform refuses to persist
      // over it, instead of silently letting Publish overwrite the real
      // document with a blank template.
      doc = { ...NULL_DIAGRAM, legacyLoadBlocked: true };
      capturedOrigin = { recoveredFromOrphan: false };
    } else {
      // A clean, confirmed-absent customContentId (deleted, or nothing ever
      // existed) with nothing left to recover — self-heals like a brand-new
      // macro: a fresh save creates a new document, and originalCustomContentId
      // (the now-dead id) still drives deriveWritebackSignals' macroNeedsRepair
      // so the macro config gets repointed at the replacement, mirroring
      // forge-graph-editor.ts's own not-found repair path. That repoint only
      // happens on submittable surfaces (inserting || configuring) though —
      // in the in-viewer Edit modal, decideWriteback correctly returns
      // needsWriteback: false (issue #170's pre-existing gate) and the macro
      // keeps pointing at the dead id.
      doc = { ...NULL_DIAGRAM };
      capturedOrigin = {
        originalCustomContentId: outcome.error.customContentId,
        recoveryPageId,
        recoveredFromOrphan: false,
      };
    }

    // Record that a dashboard-edit target actually loaded with content, so
    // saveOpenApiAndExit only pins (forces an in-place update) for a real doc.
    if (isDashboardEdit && typeof doc?.code === 'string' && doc.code.trim().length > 0) {
      dashboardEditDocLoaded = true;
    }

    // Swagger renders OpenApiExample for a new macro. Mirror that visible spec
    // (and the OpenAPI type) into Vuex so SyntaxErrorBox/AIRepair does not read
    // an empty code value from the Unknown sentinel diagram.
    const editorDiagram = createOpenApiEditorState(doc);
    store.state.diagram = editorDiagram;

    // Header title edits and saveOpenApiAndExit both use window.diagram. New
    // macros must share this initialized object too, otherwise their title is
    // visible in React but absent from the custom-content save payload.
    window.diagram = editorDiagram;

    // Telemetry: existing macro (customContentId set) loaded with an empty
    // spec. Wipe-precursor signal aligned with the cross-editor event in
    // forgeIndex.ts and graph_editor_init_empty in ForgeGraphEditor.vue.
    if (customContentId && !doc?.code) {
      trackAnalyticsEvent('editor_load_empty_active_field', {
        feature_area: 'macro',
        surface: 'editor',
        macro_type: 'openapi',
        content_id: customContentId,
      });
    }

    // eslint-disable-next-line
    // @ts-ignore
    window.updateSpec(store.state.diagram.code || OpenApiExample);

    // Initialize spec listeners for validation and store sync
    window.specListeners = window.specListeners || [];
    window.specListeners.push((spec: string) => {
      store.dispatch('updateCode2', spec);
      debouncedValidateOpenApi(spec);
    });
    store.dispatch('updateError', null);
    store.subscribe((mutation, state) => {
      if (mutation.type === 'updateCode2' && window.editor && window.specContent !== state.diagram.code) {
        window.updateSpec(state.diagram.code || '');
      }
    });

    // Render the syntax error box using Vue
    const syntaxErrorBoxContainer = document.getElementById('syntax-error-box');
    if (syntaxErrorBoxContainer) {
      syntaxErrorBoxContainer.style.fontSize = '14px'; // Set a consistent base font size
      createApp(SyntaxErrorBox, {
        onRequestAiChatRepair: () => {
          window.dispatchEvent(new CustomEvent('ai-chat-request-syntax-repair'));
        },
      }).use(store).mount(syntaxErrorBoxContainer);
    }

    // Track begin event (create or edit)
    const isNew = await MacroUtil.isCreateNew();
    if (isNew) {
      trackAnalyticsEvent('macro_create_started', {
        feature_area: 'macro',
        surface: 'editor',
        macro_type: 'openapi',
        entry_point: 'page_editor',
      });
    } else {
      trackAnalyticsEvent('macro_edit_started', {
        feature_area: 'macro',
        surface: 'editor',
        macro_type: 'openapi',
        entry_point: 'macro_toolbar',
      });
    }

    // Trigger initial validation after a short delay to ensure everything is set up
    setTimeout(() => {
      if (window.specContent) {
        debouncedValidateOpenApi(window.specContent);
      }
    }, 300); // Using 300ms to ensure everything is properly set up
  };

  const paywalled = await tryPageEditorPaywall({
    doc: NULL_DIAGRAM,
    content: SwaggerForgeEditorShell,
    contentProps: {
      onMountedBootstrap: async () => {
        bootstrapSwaggerUi(document.getElementById('openapi-bootstrap-root'));
        await mountEditorDocument();
      },
    },
    macroKind: 'openapi',
    customContentId,
  });
  if (!paywalled) {
    bootstrapSwaggerUi(document.getElementById('app'));
    await mountEditorDocument();
  }
}


// eslint-disable-next-line
// @ts-ignore
window.SwaggerEditorBundle = SwaggerEditorBundle;

void initializeMacro();
