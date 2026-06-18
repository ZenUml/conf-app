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
import globals from '@/model/globals';
import './utils/IgnoreEsc'
import { Diagram, DataSource, DiagramType, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import { saveToPlatform } from "@/model/ContentProvider/Persistence";
import MacroUtil from "@/model/MacroUtil";
import { trackEvent } from '@/utils/window';
import { toast } from '@/utils/toast';
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
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
import { reportOrphanObserved, reportOrphanMacroRepaired } from '@/utils/orphanTelemetry';

installRestoreDraftBanner();
import SwaggerForgeEditorShell from '@/components/OpenApi/SwaggerForgeEditorShell.vue';

// Captured at editor open from extension.config.uuid; forwarded back through
// view.submit's replace-semantics so Connect-era guestParams.uuid survives.
let originalConfigUuid: string | undefined;

// ZEN-1170 Defect 2b: captured at editor open so the save callback can detect
// when the persisted id differs from the macro's stale config id and repair
// the macro XML via view.submit({config:...}).
let originalCustomContentId: string | undefined;
let recoveryPageId: string | undefined;

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
  const code = window.specContent;
  console.log('saveOpenApiAndExit - window.diagram', store.state.diagram);
  const diagram = {
    ...window.diagram,
    code: code,
    diagramType: DiagramType.OpenApi,
    source: DataSource.CustomContent
  };
  console.log('saveOpenApiAndExit - diagram', JSON.stringify(diagram, null, 2));
  // @ts-ignore
  window.diagram = Object.assign(window.diagram || {}, diagram);

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
    console.error('saveOpenApiAndExit failed', error);
    trackEvent('save_failed', 'save_failed', 'error', {
      error_message: String((error as any)?.message || error).substring(0, 500),
      http_status: (error as any)?.status || (error as any)?.statusCode || 'unknown',
    });
    toast({ message: 'Failed to save. Please try again.', duration: 5000 });
    // Do NOT end journey, do NOT close — keep editor open so the user can retry.
    return;
  }
  console.log('saveOpenApiAndExit - id', id);

  // End journey on save
  if (getEditJourneyId()) {
    endEditJourney('saved');
  }

  // ZEN-1170 Defect 2b: repair stale macro XML when we saved against the
  // recovered sibling id. Only fires in surfaces where view.submit({config})
  // actually persists (insert / isConfiguring). See forgeIndex.ts for the
  // full rationale on viewer-launched modal contexts being a no-op.
  const macroNeedsRepair = !!(originalCustomContentId && id && id !== originalCustomContentId);

  /* eslint-disable no-undef */
  setTimeout(async () => {
    const [inserting, configuring] = await Promise.all([isInserting(), isConfiguring()]);
    const repairWillPersist = inserting || configuring;
    const attemptRepair = repairWillPersist && macroNeedsRepair;
    const idChanged = !!sourceId && !!id && id !== sourceId;
    const needsWriteback = inserting || idChanged || attemptRepair;
    try {
      if (needsWriteback) {
        await (await getView()).submit({config: {
          customContentId: id,
          updatedAt: new Date().toISOString(),
          ...(originalConfigUuid && { uuid: originalConfigUuid }),
        }});
        if (attemptRepair && originalCustomContentId) {
          reportOrphanMacroRepaired(recoveryPageId, originalCustomContentId, id, 'openapi');
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
  // Read customContentId from extension.config only.
  //
  // Until ZEN-1170 (2026-05-23), this read fell through to
  // `extension.modal.customContentId` when config was empty — a
  // defensive workaround copied from forgeIndex.ts. Forge-tunnel
  // verification on lite-dev (one OpenAPI macro, modal-editor context,
  // `isConfiguring: false`) showed `extension.config.customContentId`
  // resolves correctly; the fallback never fired. The safety-net
  // tracking below catches any regression — if it ever fires in prod,
  // restore the `|| extension.modal.customContentId` and investigate.
  const customContentId = context.extension?.config?.customContentId;
  originalCustomContentId = customContentId;
  recoveryPageId = context.extension?.content?.id;
  if (!customContentId && context.extension?.modal?.customContentId) {
    trackAnalyticsEvent('swagger_editor_config_empty_with_modal', {
      feature_area: 'macro',
      surface: 'editor',
      macro_type: 'openapi',
      content_id: String(context.extension.modal.customContentId),
    });
  }

  const mountEditorDocument = async () => {
    if (openApiDocumentHydrated) {
      return;
    }
    openApiDocumentHydrated = true;

    let doc: Diagram | undefined;
    if (!customContentId) {
    } else {
      const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(recoveryPageId, customContentId);
      console.log('loadDiagram - customContent', loaded.customContent, 'recoveredFromOrphan?', loaded.recoveredFromOrphanId);
      doc = loaded.customContent?.value;
      if (loaded.recoveredFromOrphanId && doc) {
        doc.recoveredFromOrphan = true;
        doc.recoveredFromOrphanId = loaded.recoveredFromOrphanId;
        reportOrphanObserved(recoveryPageId, customContentId, 'openapi', loaded.probeResult, {
          recoveryUsed: true,
          recoveredId: loaded.customContent?.id != null ? String(loaded.customContent.id) : undefined,
        });
      } else if (!doc) {
        reportOrphanObserved(recoveryPageId, customContentId, 'openapi', loaded.probeResult, { recoveryUsed: false });
      }
    }

    // ZEN-1170 Defect 1 sibling (PR #139): cross-page-paste recovery via
    // uuid → CC title. OpenAPI macros never used content properties (no
    // step 2 fallback exists), but the Connect-era {uuid, updatedAt}-only
    // param shape exists for them too — copy-paste leaves the destination
    // with no customContentId. Without this fallback the editor would
    // mount OpenApiExample and a first save would wipe the recovered spec.
    if (!doc) {
      const storageUuid = context.extension?.config?.uuid;
      if (storageUuid) {
        const recovered = await globals.apWrapper.findLegacyCustomContentByUuid(storageUuid);
        if (recovered?.value) {
          doc = recovered.value;
          doc.recoveredFromOrphan = true;
          trackEvent(storageUuid, 'legacy_custom_content_by_uuid_restored', 'info', {
            surface: 'editor',
            macro_type: 'openapi',
            recovered_id: String(recovered.id ?? ''),
            is_copy: doc.isCopy ? 'true' : 'false',
            ...(recoveryPageId && { page_id: recoveryPageId }),
          });
        }
      }
    }

    store.state.diagram = doc ?? NULL_DIAGRAM;

    // @ts-ignore
    window.diagram = doc;

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

    console.log('-------------- loaded spec:', doc?.code);
    // eslint-disable-next-line
    // @ts-ignore
    window.updateSpec(doc?.code || OpenApiExample);
    console.log('-------------- updateSpec with:', doc?.code);

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
      trackAnalyticsEvent('macro_edit_opened', {
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
