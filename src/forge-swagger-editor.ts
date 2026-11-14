import SwaggerEditorBundle from 'swagger-editor'
import "swagger-editor/dist/swagger-editor.css";
import "./assets/swagger-editor.css";
import SpecListener from './utils/spec-listener'

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
import { trackEvent } from '@/utils/window';
import { toast } from '@/utils/toast';
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { markPublishClicked, trackPublishCompleted } from "@/utils/analytics/publishTiming";
import { getCreationFlowProps } from '@/utils/analytics/creationFlow';
import { markEditorAuthoringStarted, registerEditorCloseTracking, trackEditorClosedWithoutSave } from "@/utils/analytics/editorCloseOutcome";
import forgeGlobal, { getView, getContext as initForgeContext, isInserting, isConfiguring } from '@/model/globals/forgeGlobal';
import EventBus from './EventBus';
import store from "@/model/store2";
import { mountRoot } from '@/mount-root';
import { showCloseWithoutSavingDialog } from './utils/modalService';
import { startEditJourney, endEditJourney, getOrCreateSession, getEditJourneyId, continueEditJourney, setEditJourneyMeta } from '@/utils/journeyTracking';
import uuidv4 from '@/utils/uuid';
import { computed, createApp, defineComponent, h } from 'vue';
import EditorMcpPromo from '@/components/AgentLink/EditorMcpPromo.vue';
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
  captureOpenApiEditorBaseline,
  createOpenApiEditorState,
  hasOpenApiEditorChanges,
  type OpenApiEditorBaseline,
} from '@/model/OpenApi/OpenApiEditorState';
import { notifyAiTitleSaved } from '@/composables/useAutoTitle';

// Captured at editor open from extension.config.uuid; forwarded back through
// view.submit's replace-semantics so Connect-era guestParams.uuid survives.
let originalConfigUuid: string | undefined;

// ZEN-1170 Defect 2b: captured at editor open so the save callback can detect
// when the persisted id differs from the macro's stale config id and repair
// the macro XML via view.submit({config:...}).
let capturedOrigin: { originalCustomContentId?: string; recoveryPageId?: string; recoveredFromOrphan: boolean } =
  { recoveredFromOrphan: false };
let isDashboardEdit = false;
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

let swaggerBundleMounted = false;
let openApiDocumentHydrated = false;
let isNewOpenApi = true;
let editorBaseline: OpenApiEditorBaseline | undefined;

function hadEditorChanges(): boolean {
  return editorBaseline !== undefined
    && hasOpenApiEditorChanges(editorBaseline, window.specContent, window.diagram);
}

/**
 * MCP promo over the OpenAPI editor (EditorMcpPromo), on the same store.
 * Mounted after the document is in the store, so the source it first sees is
 * the one the author starts from. A new spec's store code starts empty while
 * the editor shows OpenApiExample and then syncs it back, so both count as
 * the same untouched starting point.
 */
function mountEditorMcpPromo(diagramId: string | undefined) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  createApp(defineComponent({
    setup() {
      const code = computed(() => store.state.diagram.code || OpenApiExample);
      return () => h(EditorMcpPromo, {
        diagramType: 'OpenAPI',
        code: code.value,
        diagramId: diagramId ?? '',
        diagramTitle: store.state.diagram.title || '',
      });
    },
  })).use(store).mount(host);
}

function bootstrapSwaggerEditorBundle() {
  if (swaggerBundleMounted) {
    return;
  }
  if (!document.getElementById('swagger-editor')) {
    console.error('OpenAPI editor: missing #swagger-editor DOM element');
    return;
  }
  swaggerBundleMounted = true;

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
  // click in OpenApiHeader.vue). Stopped at the redirect below.
  markPublishClicked();
  const code = window.specContent;
  const diagram = buildOpenApiSaveDiagram({
    existing: window.diagram,
    spec: code,
    pinToId: isDashboardEdit && dashboardEditDocLoaded
      ? capturedOrigin.originalCustomContentId
      : undefined,
  });
  // @ts-ignore
  window.diagram = Object.assign(window.diagram || {}, diagram);

  notifyAiTitleSaved({
    title: window.diagram?.title,
    contentId: window.diagram?.id,
  });

  // @ts-ignore
  const sourceId = window.diagram?.id ? String(window.diagram.id) : '';

  let id: string;
  try {
    // @ts-ignore
    id = await saveToPlatform(window.diagram);
  } catch (error) {
    if (error instanceof LegacyLoadBlockedSaveError) {
      toast({
        message: "This diagram's content couldn't be verified — saving is disabled to prevent data loss. Please refresh the page or contact support.",
        duration: 8000,
      });
      EventBus.$emit('save-error', error);
      return;
    }
    console.error('saveOpenApiAndExit failed', error);
    EventBus.$emit('save-error', error);
    trackEvent('save_failed', 'save_failed', 'error', {
      error_message: String((error as any)?.message || error).substring(0, 500),
      http_status: (error as any)?.status || (error as any)?.statusCode || 'unknown',
      error_code: (error as any)?.code,
      error_shape: (error as any)?.errorShape,
    });
    const message = await diagnoseSaveFailure(error, { surface: 'editor', macro_type: 'openapi' }, globals.apWrapper);
    toast({ message, duration: message === GENERIC_SAVE_FAILED_MESSAGE ? 5000 : 12000 });
    return;
  }
  if (getEditJourneyId()) {
    endEditJourney('saved');
  }

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
    trackPublishCompleted({
      macro_type: 'openapi',
      operation_mode: inserting ? 'create' : 'edit',
      content_id: String(id),
      custom_content_id: String(id),
    });
    try {
      if (needsWriteback && !isValidCustomContentId(id)) {
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
      EventBus.$emit('saved', id);
    } catch (error) {
      console.error('view.submit/close failed after openapi save', error);
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
  const hadChanges = hadEditorChanges();
  const elapsedTimeMs = Date.now() - editorStartTime;

  const eventProps = {
    had_changes: hadChanges,
    source: 'swagger_editor',
    elapsed_time_ms: elapsedTimeMs,
    code_length: store.state.diagram.code?.length || 0,
    journey_id: getEditJourneyId(),
    session_id: getOrCreateSession(),
  };

  if (hadChanges) {
    const result = await showCloseWithoutSavingDialog();

    if (result === 'discard') {
      const exitEventAction = isNewOpenApi ? 'create_macro_exit' : 'edit_macro_exit';
      trackEvent('', exitEventAction, DiagramType.OpenApi, eventProps);
      await trackEditorClosedWithoutSave('discard_dialog');

      if (getEditJourneyId()) {
        endEditJourney('cancelled');
      }

      await (await getView()).close();
    } else {
      const cancelledEventAction = isNewOpenApi ? 'create_macro_exit_cancelled' : 'edit_macro_exit_cancelled';
      trackEvent('', cancelledEventAction, DiagramType.OpenApi, eventProps);
    }
  } else {
    const exitEventAction = isNewOpenApi ? 'create_macro_exit' : 'edit_macro_exit';
    trackEvent('', exitEventAction, DiagramType.OpenApi, eventProps);

    if (getEditJourneyId()) {
      endEditJourney('window_close');
    }

    await (await getView()).close();
  }
}

async function initializeMacro() {
  const context = await initForgeContext();

  originalConfigUuid = context.extension?.config?.uuid;

  const macroUuid =
    forgeGlobal.forgeContext?.localId
    || context.extension?.config?.uuid
    || uuidv4();
  const isDialog = !!context.extension?.modal;
  const isMacroConfig = !!context.extension?.macro?.isConfiguring || !!context.extension?.macro?.isInserting;

  if (isDialog || isMacroConfig) {
    const modalContext = context.extension?.modal;
    if (isDialog && modalContext?.journey_id) {
      continueEditJourney(modalContext.journey_id, macroUuid, modalContext.journey_start_time);
    } else {
      const source = isMacroConfig ? 'macro' : 'dialog';
      startEditJourney(macroUuid, source);
    }
  }

  getOrCreateSession();
  const configContentId = context.extension?.config?.customContentId;
  const modalContentId = context.extension?.modal?.customContentId;
  const customContentId = resolveEffectiveCustomContentId(context);
  isNewOpenApi = !customContentId;
  setEditJourneyMeta({
    macroType: 'openapi',
    operationMode: customContentId ? 'edit' : 'create',
  });
  isDashboardEdit = !configContentId && !!modalContentId;
  const recoveryPageId = context.extension?.content?.id;
  if (isDashboardEdit) {
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
      doc = { ...NULL_DIAGRAM, legacyLoadBlocked: true };
      capturedOrigin = { recoveredFromOrphan: false };
    } else {
      doc = { ...NULL_DIAGRAM };
      capturedOrigin = {
        originalCustomContentId: outcome.error.customContentId,
        recoveryPageId,
        recoveredFromOrphan: false,
      };
    }

    if (isDashboardEdit && typeof doc?.code === 'string' && doc.code.trim().length > 0) {
      dashboardEditDocLoaded = true;
    }

    const editorDiagram = createOpenApiEditorState(doc);
    editorBaseline = captureOpenApiEditorBaseline(editorDiagram);
    store.state.diagram = editorDiagram;
    window.diagram = editorDiagram;

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

    mountEditorMcpPromo(isNewOpenApi ? undefined : customContentId);

    markEditorAuthoringStarted();
    if (isNewOpenApi) {
      trackAnalyticsEvent('macro_create_started', {
        feature_area: 'macro',
        surface: 'editor',
        macro_type: 'openapi',
        entry_point: 'page_editor',
        ...getCreationFlowProps(),
      });
    } else {
      trackAnalyticsEvent('macro_edit_started', {
        feature_area: 'macro',
        surface: 'editor',
        macro_type: 'openapi',
        entry_point: 'macro_toolbar',
      });
    }
    registerEditorCloseTracking({
      getMacroType: () => 'openapi',
      operationMode: isNewOpenApi ? 'create' : 'edit',
      hadChanges: hadEditorChanges,
    });

    setTimeout(() => {
      if (window.specContent) {
        debouncedValidateOpenApi(window.specContent);
      }
    }, 300);
  };

  const shellProps = {
    saveAndExit: saveOpenApiAndExit,
    exit,
    onMountedBootstrap: async () => {
      bootstrapSwaggerEditorBundle();
      await mountEditorDocument();
    },
  };

  const paywalled = await tryPageEditorPaywall({
    doc: NULL_DIAGRAM,
    content: SwaggerForgeEditorShell,
    contentProps: shellProps,
    macroKind: 'openapi',
    customContentId,
  });
  if (!paywalled) {
    mountRoot(NULL_DIAGRAM, SwaggerForgeEditorShell, shellProps);
  }
}

// eslint-disable-next-line
// @ts-ignore
window.SwaggerEditorBundle = SwaggerEditorBundle;

void initializeMacro();
