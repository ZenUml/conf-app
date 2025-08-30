import globals from '@/model/globals';
import { getView, getContext as initForgeContext, isEditorMode, openModal, isInserting } from '@/model/globals/forgeGlobal';
import EventBus from './EventBus'
import {trackEvent} from "@/utils/window";
import {Diagram, DiagramType} from "@/model/Diagram/Diagram";

import './assets/tailwind.css'
import { saveToPlatform } from "./model/ContentProvider/Persistence";
import macroMetrics from "@/services/MacroMetrics";
import store from './model/store2'

import Example from "./utils/sequence/Example";
import { showCloseWithoutSavingDialog } from './utils/modalService';
import { handleGetStartedRoute } from './routes/getStarted';

// Track editor session start time
const editorStartTime = Date.now();



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
    await initForgeContext();

    // Check if this is a global settings route (get started page)
    const context = await initForgeContext();
    if (context.extension?.type === 'confluence:globalSettings') {
      await handleGetStartedRoute();
      return { macroData: null };
    }

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

    const context = await initForgeContext();

    // Skip loading heavy components if this is a global settings context
    if (context.extension?.type === 'confluence:globalSettings') {
      console.log('Skipping heavy components load for global settings context');
      return;
    }

    let doc;
    const customContentId = context.extension?.config?.customContentId;
    if(!customContentId) {
      doc = {
        diagramType: DiagramType.Sequence,
        code: Example.Sequence,
        mermaidCode: Example.Mermaid,
        isNew: true
      }
    } else {
      const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
      doc = customContent?.value;
    }



    // Hide skeleton loader before mounting the actual content
    const skeletonLoader = document.getElementById('skeleton-loader');
    if (skeletonLoader) {
      skeletonLoader.style.display = 'none';
    }

    const isSequence = context.moduleKey === 'zenuml-sequence-macro';
    const isGraph = context.moduleKey === 'zenuml-graph-macro';
    const isEmbed = context.moduleKey === 'zenuml-embed-macro';

    const editable = await isEditorMode();
    if(isSequence) {
      const component = editable 
      ? (await import("@/components/Workspace.vue")).default
      : (await import("@/components/DiagramPortal.vue")).default;
      
      //@ts-ignore
      mountRoot(doc, component, { autoResize: !editable });
    } else if(isGraph) {
      await import(editable ? "@/forge-graph-editor" : "@/forge-graph-viewer");
    } else if(isEmbed) {
      await import(editable ? "@/forge-embed-editor" : "@/forge-embed-viewer");
    } else {
      await import(editable ? "@/forge-swagger-editor" : "@/forge-swagger-ui");
    }

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

EventBus.$on('edit', async() => {
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
    if(await isInserting()) {
      await (await getView()).submit({config: {customContentId: id, updatedAt: new Date().toISOString()}});
    } else {
      await (await getView()).close();
    }
  }, 500);
});

EventBus.$on('exit', async (showWarning: boolean) => {
  console.log('exit', showWarning);
  
  // Track exit event with context
  const isNewSequence = !store.state.diagram.id && store.state.diagram.diagramType === DiagramType.Sequence;
  const elapsedTimeMs = Date.now() - editorStartTime;
  
  trackEvent('', 'create_macro_exit', DiagramType.Sequence, {
    had_changes: showWarning,
    macro_stage: isNewSequence ? 'creation' : 'editing',
    elapsed_time_ms: elapsedTimeMs,
    code_length: store.state.diagram.code?.length || 0
  });
  
  if (showWarning) {
    // Show custom modal dialog for Forge (similar to Connect)
    const result = await showCloseWithoutSavingDialog();
    if (result === 'discard') {
      await (await getView()).close();
    }
  } else {
    await (await getView()).close();
  }
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

EventBus.$on('updateContent', async (diagram: Diagram) => {
  if (await globals.apWrapper.canUserEdit()) {
    saveToPlatform(diagram)
  } else {
    console.info('Your changes cannot be persistent as you are not authorized to edit.');
  }
});


