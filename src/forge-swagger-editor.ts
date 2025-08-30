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
  
  // Track exit event with context
  const isNewOpenApi = !store.state.diagram.id && store.state.diagram.diagramType === DiagramType.OpenApi;
  const elapsedTimeMs = Date.now() - editorStartTime;
  
  trackEvent('', 'create_macro_exit', DiagramType.OpenApi, {
    had_changes: codeChanged,
    macro_stage: isNewOpenApi ? 'creation' : 'editing',
    elapsed_time_ms: elapsedTimeMs,
    code_length: store.state.diagram.code?.length || 0
  });
  
  if (codeChanged) {
    // Show custom modal dialog for Forge (similar to Connect)
    const result = await showCloseWithoutSavingDialog();
    if (result === 'discard') {
      await (await getView()).close();
    }
  } else {
    await (await getView()).close();
  }
}

async function initializeMacro() {
  const context = await initForgeContext();

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

  if (await MacroUtil.isCreateNew()) {
    trackEvent('', 'create_macro_begin', 'openapi');
  }
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