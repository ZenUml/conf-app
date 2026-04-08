
// Load external DrawIO scripts dynamically
function loadDrawIOScripts(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const scripts = [
      'https://conf-full.zenuml.com/drawio/js/sanitizer/purify.min.js',
      'https://conf-full.zenuml.com/drawio/mxgraph/mxClient.js',
      'https://conf-full.zenuml.com/drawio/js/grapheditor/Init.js',
      'https://conf-full.zenuml.com/drawio/js/grapheditor/Graph.js',
      'https://conf-full.zenuml.com/drawio/js/grapheditor/Shapes.js'
    ];
    
    let loadedCount = 0;
    
    scripts.forEach((src, index) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        loadedCount++;
        if (loadedCount === scripts.length) {
          // Wait for window.Graph to be available
          const checkGraph = () => {
            if (window.Graph) {
              console.log('window.Graph is available:', window.Graph);
              resolve();
            } else {
              console.log('Waiting for window.Graph...');
              setTimeout(checkGraph, 100);
            }
          };
          checkGraph();
        }
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  });
}

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
import { Diagram, NULL_DIAGRAM } from "@/model/Diagram/Diagram";

async function loadDiagram() {
  const context = await initForgeContext();

  let doc: Diagram | undefined;
  const customContentId = context.extension?.config?.customContentId;
  if(!customContentId) {
  } else {
    const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
    console.log('loadDiagram - customContent', customContent);
    doc = customContent?.value;
  }
  store.state.diagram = doc ?? NULL_DIAGRAM;
  window.diagram = doc ?? NULL_DIAGRAM;
  console.log('loadDiagram - window.diagram', window.diagram);

  mountRoot(doc ?? NULL_DIAGRAM, ForgeGraphViewer, {
    graphXml: doc?.graphXml
  });

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
    try {
      if(globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()) {
        await createAttachmentIfContentChanged(graphXml ?? '');
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
    // Load DrawIO scripts first
    // await loadDrawIOScripts();
    trackEvent('', 'view_macro', 'graph');
    await loadDiagram();
  } catch (e) {
    console.error('Error loading graph viewer', e);
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

