import "https://confluence-plugin.pages.dev/drawio/js/sanitizer/purify.min.js";
import "https://confluence-plugin.pages.dev/drawio/mxgraph/mxClient.js";
import "https://confluence-plugin.pages.dev/drawio/js/grapheditor/Init.js";
import "https://confluence-plugin.pages.dev/drawio/js/grapheditor/Graph.js";
import "https://confluence-plugin.pages.dev/drawio/js/grapheditor/Shapes.js";
import AP from "@/model/AP";
import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent} from "@/utils/window";
import globals from '@/model/globals';
import {decompress} from '@/utils/compress';
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import ApWrapper2 from "@/model/ApWrapper2";
import ForgeGraphViewer from "@/components/Viewer/ForgeGraphViewer.vue";
import EventBus from './EventBus'
import {mountRoot} from "@/mount-root";
import macroMetrics from '@/services/MacroMetrics';
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import store from "@/model/store2";
import GraphExample from '@/model/Graph/GraphExample';

// Type declarations for global window properties
declare global {
  interface Window {
    diagram: any;
    graph: any;
    setGraphStyle?: (styleUrl: string, graph: any) => void;
    setGraphXml?: (xml: string, graph: any) => void;
    updateGraph?: (xml: string) => void;
  }
}

function initGraphViewer() {
  const elementId = 'graph';
  const element = document.getElementById(elementId);
  if(element && element.innerHTML.trim()) {
    element.innerHTML = '';
  }

  // Initialize DrawIO viewer logic here
  // This would be similar to how initSwaggerUi() works
  // @ts-ignore
  const graph = new Graph(element);
  graph.resizeContainer = true;
  graph.setEnabled(false);

  // @ts-ignore
  setGraphStyle && setGraphStyle('styles/default.xml', graph);
  
  // @ts-ignore
  window.graph = graph;
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

  let graphXml = doc?.graphXml;
  if (doc?.compressed) {
    trackEvent('compressed_field_viewer', 'load', 'warning');
    if (!graphXml?.startsWith('<mxGraphModel')) {
      graphXml = decompress(doc.graphXml);
      trackEvent('compressed_content_viewer', 'load', 'warning');
    }
  }

  // @ts-ignore
  window.updateGraph && window.updateGraph(graphXml || GraphExample.graphXml);

  setTimeout(async function () {
    AP.resize();
    try {
      if(globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()) {
        await createAttachmentIfContentChanged(graphXml);
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
  trackEvent(macroData?.uuid, 'view_macro', 'graph');

  const compositeContentProvider = defaultContentProvider(new ApWrapper2(AP));
  const {doc} = await compositeContentProvider.load();
  mountRoot(doc, ForgeGraphViewer);
  initGraphViewer();

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

EventBus.$on('fullscreen', () => {
  // @ts-ignore
  AP.dialog.create(
    {
      key: 'zenuml-content-graph-viewer-dialog',
      chrome: true,
      width: "100%",
      height: "100%",
    });
}); 