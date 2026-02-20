import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent} from "@/utils/window";
import globals from '@/model/globals';
import ForgeEmbedViewer from "@/components/Viewer/ForgeEmbedViewer.vue";
import EventBus from './EventBus'
import {mountRoot} from "@/mount-root";
import macroMetrics from '@/services/MacroMetrics';
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import store from "@/model/store2";

// Type declarations for global window properties
declare global {
  interface Window {
    diagram: any;
  }
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
  store.state.diagram = doc || {};
  window.diagram = doc || {};
  console.log('loadDiagram - window.diagram', window.diagram);

  mountRoot(doc, ForgeEmbedViewer, {
    diagramType: doc?.diagramType,
    doc: doc
  });

  setTimeout(async function () {
    try {
      if(globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()) {
        await createAttachmentIfContentChanged(doc?.code || doc?.graphXml || doc?.mermaidCode);
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
  try {
    await globals.apWrapper.initializeContext();
    trackEvent('', 'view_macro', 'embed');

    // Initialize with empty doc, will be loaded in loadDiagram
    const doc = {};
    mountRoot(doc, ForgeEmbedViewer);
    await loadDiagram();
  } catch (e) {
    console.error('Error loading embed viewer', e);
  }
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
      macroMode: 'fullscreen',
    },
  });
}); 