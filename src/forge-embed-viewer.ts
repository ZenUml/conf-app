import AP from "@/model/AP";
import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent} from "@/utils/window";
import globals from '@/model/globals';
import {decompress} from '@/utils/compress';
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import ApWrapper2 from "@/model/ApWrapper2";
import ForgeEmbedViewer from "@/components/Viewer/ForgeEmbedViewer.vue";
import EventBus from './EventBus'
import {mountRoot} from "@/mount-root";
import macroMetrics from '@/services/MacroMetrics';
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import store from "@/model/store2";
import { DiagramType } from "@/model/Diagram/Diagram";

// Type declarations for global window properties
declare global {
  interface Window {
    diagram: any;
  }
}

function getViewerUrl(diagramType: DiagramType) {
  if(diagramType == DiagramType.Sequence || diagramType == DiagramType.Mermaid) {
    return '/sequence-viewer.html';
  }
  if(diagramType == DiagramType.Graph) {
    return '/drawio/viewer.html';
  }
  if(diagramType == DiagramType.OpenApi) {
    return '/swagger-ui.html';
  }

  console.warn(`Unknown diagramType: ${diagramType}`);
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
    diagramType: doc?.diagramType
  });

  // Redirect to the appropriate viewer based on diagram type
  if (doc?.diagramType) {
    const viewerUrl = getViewerUrl(doc.diagramType);
    if (viewerUrl) {
      const url = `${viewerUrl}${window.location.search}`;
      // Load the viewer in an iframe or redirect
      loadViewer(url);
    }
  }

  setTimeout(async function () {
    AP.resize();
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

function loadViewer(url: string) {
  const e = document.createElement('meta');
  e.setAttribute('http-equiv', 'refresh');
  e.setAttribute('content', `0;URL='${url}'`);
  const h = document.getElementsByTagName('head')[0];
  h && h.appendChild(e);
}

async function initializeMacro() {
  try {
    await globals.apWrapper.initializeContext();
    const macroData = await globals.apWrapper.getMacroData();
    trackEvent(macroData?.uuid, 'view_macro', 'embed');

    const compositeContentProvider = defaultContentProvider(new ApWrapper2(AP));
    const {doc} = await compositeContentProvider.load();
    
    mountRoot(doc, ForgeEmbedViewer);
    await loadDiagram();
    await macroMetrics.reportMacroMetrics();
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

EventBus.$on('fullscreen', () => {
  // @ts-ignore
  AP.dialog.create(
    {
      key: 'zenuml-content-embed-viewer-dialog',
      chrome: true,
      width: "100%",
      height: "100%",
    });
}); 