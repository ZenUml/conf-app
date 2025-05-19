import ApWrapper2 from "@/model/ApWrapper2";
import globals from '@/model/globals';

import AP from "@/model/AP";
import EventBus from './EventBus'
import {trackEvent} from "@/utils/window";
import {Diagram, DiagramType} from "@/model/Diagram/Diagram";

import './assets/tailwind.css'
import { saveToPlatform } from "./model/ContentProvider/Persistence";
import macroMetrics from "@/services/MacroMetrics";

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
      { default: defaultContentProvider },
      { mountRoot }
    ] = await Promise.all([
      import("@/model/ContentProvider/CompositeContentProvider"),
      import("@/mount-root")
    ]);

    // Initialize content provider
    const compositeContentProvider = defaultContentProvider(globals.apWrapper as ApWrapper2);
    let {doc} = await compositeContentProvider.load();

    // Hide skeleton loader before mounting the actual content
    const skeletonLoader = document.getElementById('skeleton-loader');
    if (skeletonLoader) {
      skeletonLoader.style.display = 'none';
    }

    // Dynamically import DiagramPortal component
    const DiagramPortal = (await import("@/components/DiagramPortal.vue")).default;

    // Mount the root component
    mountRoot(doc, DiagramPortal);
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
  AP.dialog.create({
    key: 'zenuml-content-sequence-editor-dialog',
      chrome: false,
      width: "100%",
      height: "100%",
  }).on('close', async () => {
    location.reload();
  });
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
