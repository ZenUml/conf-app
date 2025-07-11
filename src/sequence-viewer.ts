import ApWrapper2 from "@/model/ApWrapper2";
import globals from '@/model/globals';

import AP from "@/model/AP";
import EventBus from './EventBus'
import {trackEvent} from "@/utils/window";
import {Diagram, DiagramType} from "@/model/Diagram/Diagram";

import './assets/tailwind.css'
import { saveToPlatform } from "./model/ContentProvider/Persistence";
import macroMetrics from "@/services/MacroMetrics";
import store from './model/store2'
import { view, requestConfluence, invoke, Modal } from "@forge/bridge";

import Example from "./utils/sequence/Example";

// Initialize critical path rendering first
async function initializeCriticalPath() {
  // Hide skeleton loader after critical content is loaded
  const hideSkeletonLoader = () => {
    const skeletonLoader = document.getElementById('skeleton-loader');
    if (skeletonLoader) {
      skeletonLoader.style.display = 'none';
    }
  };

  try {
    const context = await view.getContext();
    (globals.apWrapper as ApWrapper2).isForge = !!context;
    (globals.apWrapper as ApWrapper2).forgeContext = context;

    console.log('sequence-viewer - context', context);

    // Initialize context and get macro data (lightweight operations)
    await globals.apWrapper.initializeContext();
    const macroData = await globals.apWrapper.getMacroData();

    // Report metrics (can run in parallel with heavy content loading)
    macroMetrics.reportMacroMetrics().catch(e => console.error('Error reporting metrics:', e));

    // Return the macro data for use in the second phase
    return { macroData };
  } catch (error) {
    console.error('Error in critical path initialization:', error);
    hideSkeletonLoader(); // Hide skeleton even on error
    throw error;
  }
}

// Load heavy components asynchronously
async function loadHeavyComponents(criticalData: { macroData: any }) {
  try {
    // Dynamically import heavy dependencies
    const [
      { mountRoot }
    ] = await Promise.all([
      import("@/mount-root")
    ]);

    const context = await view.getContext();

    let doc;
    if(!context.extension?.config?.customContentId) {
      doc = {
        diagramType: DiagramType.Sequence,
        code: Example.Sequence,
        mermaidCode: Example.Mermaid,
        isNew: true
      }
    } else {
      const customContent2 = await globals.apWrapper.getCustomContentByIdV2(context.extension.config.customContentId);
      console.log('Custom content2:', customContent2);
      doc = customContent2?.value;
    }

    // Hide skeleton loader before mounting the actual content
    const skeletonLoader = document.getElementById('skeleton-loader');
    if (skeletonLoader) {
      skeletonLoader.style.display = 'none';
    }

    const component = context.extension.modal?.macroMode === 'editor' || context.extension.isEditing
      ? (await import("@/components/Workspace.vue")).default : (await import("@/components/DiagramPortal.vue")).default;
    
    //@ts-ignore
    mountRoot(doc, component);

  } catch (error) {
    console.error('Error loading heavy components:', error);
    // Hide skeleton loader even on error
    const skeletonLoader = document.getElementById('skeleton-loader');
    if (skeletonLoader) {
      skeletonLoader.style.display = 'none';
    }
    throw error;
  }
}

// Main function to orchestrate the two-phase loading
async function main() {
  // Phase 1: Critical path rendering
  const criticalData = await initializeCriticalPath();

  // Phase 2: Load heavy components
  loadHeavyComponents(criticalData).catch(e =>
    console.error('Failed to load heavy components:', e)
  );
}

export default main()

EventBus.$on('diagramLoaded', () => {
  const resizeAfterDelay = () => {
    console.log('Resizing viewport after diagram loaded');
    // @ts-ignore
    window.AP?.resize();
  };
  setTimeout(resizeAfterDelay, 1500);
});

// Dynamically import createAttachmentIfContentChanged only when needed
const createAttachmentIfContentChangedPromise = import("@/model/Attachment").then(
  module => module.default
);

async function createAttachment(code: string, diagramType: DiagramType) {
  try {
    if (globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()) {
      const createAttachmentIfContentChanged = await createAttachmentIfContentChangedPromise;
      await createAttachmentIfContentChanged(code);
    } else {
      console.debug("Attachment will no be created as it's not in view mode or the user is unauthorized to edit.");
    }
  } catch (e) {
    // Do not re-throw the error
    console.error("Error when creating attachment", e);

    // Improved error tracking with more detailed information
    let errorDetails: any = { message: e.message };

    // Extract XHR details if available
    if (e.xhr) {
      errorDetails.xhr = {
        status: e.xhr.status,
        statusText: e.xhr.statusText
      };

      // Try to extract the full response text
      try {
        // For HTML responses, extract text content to avoid HTML tags
        if (e.xhr.responseText && e.xhr.responseText.includes('<!doctype html>')) {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = e.xhr.responseText;
          errorDetails.xhr.responseDetails = tempDiv.textContent?.substring(0, 500) || 'HTML response (extracted text)';
        } else {
          // For other responses, include the raw text
          errorDetails.xhr.responseDetails = e.xhr.responseText?.substring(0, 500) || 'No response text';
        }
      } catch (parseError) {
        errorDetails.xhr.responseDetails = 'Error parsing response: ' + parseError.message;
      }
    }

    // Track the error with enhanced details
    trackEvent(JSON.stringify(errorDetails), 'create_attachment' + diagramType, 'error');
  }
}

EventBus.$on('diagramLoaded', async (code: string, diagramType: DiagramType) => {
  setTimeout(async () => {
    await createAttachment(code, diagramType);
  }, 1500);
});

EventBus.$on('edit', () => {
  const modal = new Modal({
    resource: 'main',
    onClose: (payload) => {
      console.log('onClose called with', payload);
      location.reload();
    },
    size: 'max',
    context: {
      macroMode: 'editor',
    },
  });

  modal.open();
});


EventBus.$on('save', async () => {
  console.log('save', store.state.diagram);

  const isNewSequence = !store.state.diagram.id && store.state.diagram.diagramType === "sequence"
  store.state.diagram.isNew = false;
  const id = await saveToPlatform(store.state.diagram);
  const preservedTheme = sessionStorage.getItem(`${location.hostname}-preserve-zenuml-conf-theme`);
  if (isNewSequence && preservedTheme) {
    sessionStorage.removeItem(`${location.hostname}-preserve-zenuml-conf-theme`);
    localStorage.setItem(`${location.hostname}-${id}-zenuml-conf-theme`, preservedTheme);
  }
  // Give some time for track event to be sent out. We are not using a more reliable way to track event because
  // we don't want to block dialog close for too long.
  setTimeout(async () => {
    if((globals.apWrapper as ApWrapper2).forgeContext?.extension?.macro?.isInserting) {
      await view.submit({config: {customContentId: id, updatedAt: new Date().toISOString()}});
    } else {
      await view.close();
    }
  }, 500);
});

EventBus.$on('exit', () => {
  view.close();
});

EventBus.$on('fullscreen', () => {
  AP.dialog.create({
    key: 'zenuml-content-sequence-viewer-dialog',
    chrome: true,
    width: "100%",
    height: "100%",
  }).on('close', async () => {
    location.reload();
  });
});

EventBus.$on('updateContent', async (diagram: Diagram) => {
  if (await globals.apWrapper.canUserEdit()) {
    saveToPlatform(diagram)
  } else {
    AP.messages.info('Your changes cannot be persistent as you are not authorized to edit.');
  }
});
