import SwaggerUIBundle from 'swagger-ui'
import "swagger-ui/dist/swagger-ui.css";
import SpecListener from './utils/spec-listener'
import './assets/tailwind.css'

import OpenApiExample from '@/model/OpenApi/OpenApiExample'
import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent} from "@/utils/window";
import globals from '@/model/globals';
import OpenApiViewer from "@/components/Viewer/OpenApiViewer.vue";
import EventBus from './EventBus'
import {mountRoot} from "@/mount-root";
import macroMetrics from "@/services/MacroMetrics";
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import store from "@/model/store2";

// @ts-ignore
window.SwaggerUIBundle = SwaggerUIBundle;

function initSwaggerUi() {
  const elementId = 'swagger-ui';
  const element = document.getElementById(elementId);
  if(element && element.innerHTML.trim()) {
    element.innerHTML = '';
  }

  const ui = SwaggerUIBundle({
    // url: "https://petstore.swagger.io/v2/swagger.json",
    dom_id: `#${elementId}`,
    presets: [
      SwaggerUIBundle.presets.apis,
      // SwaggerUIStandalonePreset
    ],
    plugins: [
      SwaggerUIBundle.plugins.DownloadUrl,
      SpecListener
    ],
    // requestSnippetsEnabled: true,
    // layout: "StandaloneLayout"
  })

  // eslint-disable-next-line
  // @ts-ignore
  window.ui = ui
}

async function loadDiagram() {

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
  window.diagram = doc;
  console.log('loadDiagram - window.diagram', window.diagram);

  // eslint-disable-next-line
  // @ts-ignore
  window.updateSpec(doc?.code || OpenApiExample);

  setTimeout(async function () {
    try {
      if(globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()) {
        await createAttachmentIfContentChanged(doc?.code);
      } else {
        console.debug("Attachment will no be created as it's not in view mode or the user is unauthorized to edit.");
      }
    } catch (e) {
      // Do not re-throw the error
      console.error("Error when creating attachment", e);
      trackEvent(JSON.stringify(e), 'create_attachment', 'error');
    }

  }, 1500);
}

async function initializeMacro() {
  await globals.apWrapper.initializeContext();
  const macroData = await globals.apWrapper.getMacroData();
  trackEvent(macroData?.uuid, 'view_macro', 'openapi');

  // Initialize with empty doc, will be loaded in loadDiagram
  const doc = {};
  mountRoot(doc, OpenApiViewer);
  initSwaggerUi();

  await loadDiagram();

  await macroMetrics.reportMacroMetrics();
}

export default initializeMacro();

EventBus.$on('edit', async () => {
  await openModal({
    resource: 'main',
    onClose: (payload: any) => {
      console.log('onClose called with', payload);
      location.reload();
    },
    size: 'max',
    context: {
      macroMode: 'editor',
    },
  });
});

EventBus.$on('fullscreen', async () => {
  await openModal({
    resource: 'main',
    onClose: (payload: any) => {
      console.log('onClose called with', payload);
      location.reload();
    },
    size: 'max',
    context: {
      macroMode: 'viewer',
    },
  });
});
