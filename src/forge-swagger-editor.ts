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
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { getView, getContext as initForgeContext, isInserting } from '@/model/globals/forgeGlobal';
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

installRestoreDraftBanner();
import SwaggerForgeEditorShell from '@/components/OpenApi/SwaggerForgeEditorShell.vue';

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
  // @ts-ignore
  const id = await saveToPlatform(window.diagram);
  console.log('saveOpenApiAndExit - id', id);
  
  // End journey on save
  if (getEditJourneyId()) {
    endEditJourney('saved');
  }

  /* eslint-disable no-undef */
  setTimeout(async () => {
    if(await isInserting()) {
      await (await getView()).submit({config: {customContentId: id, updatedAt: new Date().toISOString()}});
    } else {
      await (await getView()).close();
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
  
  // Start journey tracking
  const macroUuid = context.extension?.config?.uuid || uuidv4();
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
  const customContentId = context.extension?.config?.customContentId;

  const mountEditorDocument = async () => {
    if (openApiDocumentHydrated) {
      return;
    }
    openApiDocumentHydrated = true;

    let doc: Diagram | undefined;
    if (!customContentId) {
    } else {
      const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
      console.log('loadDiagram - customContent', customContent);
      doc = customContent?.value;
    }
    store.state.diagram = doc ?? NULL_DIAGRAM;

    // @ts-ignore
    window.diagram = doc;

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
      createApp(SyntaxErrorBox).use(store).mount(syntaxErrorBoxContainer);
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