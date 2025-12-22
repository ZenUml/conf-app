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
import { DataSource, DiagramType } from "@/model/Diagram/Diagram";
import { saveToPlatform } from "@/model/ContentProvider/Persistence";
import MacroUtil from "@/model/MacroUtil";
import { trackEvent } from '@/utils/window';
import { getView, getContext as initForgeContext, isInserting } from '@/model/globals/forgeGlobal';
import store from "@/model/store2";
import { showCloseWithoutSavingDialog } from './utils/modalService';
import { startEditJourney, endEditJourney, getOrCreateSession, getEditJourneyId, continueEditJourney } from '@/utils/journeyTracking';
import uuidv4 from '@/utils/uuid';

// Track editor session start time
const editorStartTime = Date.now();

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

  let doc;
  const customContentId = context.extension?.config?.customContentId;
  if(!customContentId) {
  } else {
    const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
    console.log('loadDiagram - customContent', customContent);
    doc = customContent?.value;
  }
  store.state.diagram = doc;

  // @ts-ignore
  window.diagram = doc;

  console.log('-------------- loaded spec:', doc?.code)
  // eslint-disable-next-line
  // @ts-ignore
  window.updateSpec(doc?.code || OpenApiExample);
  console.log('-------------- updateSpec with:', doc?.code)

  // Track begin event (create or edit)
  const isNew = await MacroUtil.isCreateNew();
  const beginEventAction = isNew ? 'create_macro_begin' : 'edit_macro_begin';
  
  trackEvent('', beginEventAction, 'openapi', {
    journey_id: getEditJourneyId(),
    session_id: getOrCreateSession(),
  });
}


// eslint-disable-next-line
// @ts-ignore
window.SwaggerEditorBundle = SwaggerEditorBundle;

function onload() {
  console.log('swagger-editor - window.onload');

  ReactDOM.render(
    React.createElement(SwaggerEditor as any, { saveAndExit: saveOpenApiAndExit, exit: exit }),
    document.getElementById('app')
  );
  
  // Build a system
  const editor = SwaggerEditorBundle({
    dom_id: '#swagger-editor',
    // layout: 'StandaloneLayout',
    presets: [
      // SwaggerEditorStandalonePreset
    ],
    plugins: [SpecListener],
    // url: 'https://raw.githubusercontent.com/OAI/OpenAPI-Specification/main/examples/v3.0/uspto.json'
  })

  // eslint-disable-next-line
  // @ts-ignore
  window.editor = editor

  initializeMacro();
}

onload();