import SwaggerEditorBundle from 'swagger-editor'
import "swagger-editor/dist/swagger-editor.css";
import SpecListener from './utils/spec-listener'

import React from 'react';
import ReactDOM from 'react-dom';
import Header from "@/components/react/Header";
// @ts-ignore
import './assets/tailwind.css'

import OpenApiExample from '@/model/OpenApi/OpenApiExample'
import globals from '@/model/globals';
import AP from "@/model/AP";
import './utils/IgnoreEsc'
import { DataSource, DiagramType } from "@/model/Diagram/Diagram";
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import { saveToPlatform } from "@/model/ContentProvider/Persistence";
import ApWrapper2 from "@/model/ApWrapper2";
import MacroUtil from "@/model/MacroUtil";
import { trackEvent } from '@/utils/window';
import { startEditJourney, endEditJourney, getOrCreateSession, getEditJourneyId, continueEditJourney } from '@/utils/journeyTracking';
import { detectEditMode } from '@/utils/editModeDetection';
import uuidv4 from '@/utils/uuid';
// Import Vue and store for the SyntaxErrorBox
import { createApp } from 'vue';
import SyntaxErrorBox from "@/components/SyntaxErrorBox.vue";
import store from '@/model/store2';
// Import validation utilities
import { validateOpenApiSpecForStore } from '@/utils/openapi/validate';
import { debounce } from 'lodash';

async function saveOpenApiAndExit() {
  const code = window.specContent;
  const diagram = {
    ...window.diagram,
    code: code,
    diagramType: DiagramType.OpenApi,
    source: DataSource.CustomContent
  };
  // @ts-ignore
  window.diagram = Object.assign(window.diagram || {}, diagram);
  // @ts-ignore
  await saveToPlatform(window.diagram);
  
  // End journey on save
  if (getEditJourneyId()) {
    endEditJourney('saved');
  }

  /* eslint-disable no-undef */
  AP.dialog.close();
}

async function exit() {
  const codeChanged = window.diagram?.code !== window.specContent;
  
  // End journey on exit
  if (getEditJourneyId()) {
    endEditJourney(codeChanged ? 'cancelled' : 'window_close');
  }
  
  if (codeChanged) {
    AP.dialog.create({
      key: 'zenuml-close-without-saving-dialog',
      width: 500,
      height: 300,
      chrome: false,
    }).on('close', (data: any) => {
      // close the editor dialog if the user clicks on the discard button
      if (data.action === 'discard') {
        AP.dialog.close();
      }
    });
  } else {
    AP.dialog.close();
  }
}

// Create a debounced validation function
const debouncedValidateOpenApi = debounce(async (spec: string) => {
  if (!spec) {
    store.dispatch('updateError', null);
    return;
  }
  await validateOpenApiSpecForStore(spec, store, 'updateError');
}, 1000);


async function initializeMacro() {
  const apWrapper = globals.apWrapper;
  await apWrapper.initializeContext();
  
  // Start journey tracking
  const macroData = await apWrapper.getMacroData();
  const macroUuid = macroData?.uuid || uuidv4();
  
  // Check if journey was passed from parent
  const customData: any = await new Promise((resolve) => {
    try {
      AP.dialog.getCustomData((data: any) => resolve(data));
    } catch (e) {
      resolve(undefined); // Intended to avoid breaking local development access
    }
  });
  if (customData?.journey_id) {
    continueEditJourney(customData.journey_id, macroUuid, customData.journey_start_time);
  } else {
    // Start new journey
    const editMode = await detectEditMode(apWrapper);
    if (editMode.source !== 'inline' && editMode.source !== 'unknown') {
      startEditJourney(macroUuid, editMode.source);
    }
  }
  
  // Ensure session is initialized
  getOrCreateSession();

  const compositeContentProvider = defaultContentProvider(new ApWrapper2(AP));
  const { doc } = await compositeContentProvider.load();

  // @ts-ignore
  window.diagram = doc;

  console.log('-------------- loaded spec:', doc?.code)
  // eslint-disable-next-line
  // @ts-ignore
  window.updateSpec(doc?.code || OpenApiExample);
  console.log('-------------- updateSpec with:', doc?.code)

  // Initialize spec listeners for validation and store sync
  window.specListeners = window.specListeners || [];
  window.specListeners.push((spec: string) => {
    // Update the Vuex store with the current spec content
    store.dispatch('updateCode2', spec);
    // Validate the spec
    debouncedValidateOpenApi(spec);
  });
  // Set initial error state to null
  store.dispatch('updateError', null);
  // Subscribe to store changes to update the editor when code is changed programmatically
  // (e.g. when AI repair applies changes)
  store.subscribe((mutation, state) => {
    if (mutation.type === 'updateCode2' && window.editor && window.specContent !== state.diagram.code) {
      // Update the spec in the editor
      window.updateSpec(state.diagram.code || '');
    }
  });

  ReactDOM.render(
    React.createElement(Header as any, { saveAndExit: saveOpenApiAndExit, exit: exit }),
    document.getElementById('header')
  );

  // Render the syntax error box using Vue
  const syntaxErrorBoxContainer = document.getElementById('syntax-error-box');
  if (syntaxErrorBoxContainer) {
    // Add consistent font sizing to ensure it matches the rest of the UI
    syntaxErrorBoxContainer.style.fontSize = '14px'; // Set a consistent base font size
    createApp(SyntaxErrorBox).use(store).mount(syntaxErrorBoxContainer);
  }

  // Track begin event (create or edit)
  const isNew = await MacroUtil.isCreateNew();
  const beginEventAction = isNew ? 'create_macro_begin' : 'edit_macro_begin';
  
  trackEvent('', beginEventAction, 'openapi', {
    journey_id: getEditJourneyId(),
    session_id: getOrCreateSession(),
  });
  
  // Trigger initial validation after a short delay to ensure everything is set up
  setTimeout(() => {
    if (window.specContent) {
      debouncedValidateOpenApi(window.specContent);
    }
  }, 300); // Using 300ms to ensure everything is properly set up
}


// eslint-disable-next-line
// @ts-ignore
window.SwaggerEditorBundle = SwaggerEditorBundle;

window.onload = function () {
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
