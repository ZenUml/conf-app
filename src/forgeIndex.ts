import globals from '@/model/globals';
import { getView, getContext as initForgeContext, isEditorMode, openModal, isInserting, isFullscreenMode } from '@/model/globals/forgeGlobal';
import EventBus from './EventBus'
import {trackEvent, serializeError} from "@/utils/window";
import { toast } from '@/utils/toast';
import {Diagram, DiagramType} from "@/model/Diagram/Diagram";

import './assets/tailwind.css'
import { saveToPlatform } from "./model/ContentProvider/Persistence";
import macroMetrics from "@/services/MacroMetrics";
import store from './model/store2'

import Example from "./utils/sequence/Example";
import { showCloseWithoutSavingDialog } from './utils/modalService';
import { handleGetStartedRoute } from './routes/getStarted';
import { startEditJourney, endEditJourney, getOrCreateSession, getEditJourneyId, getEditJourneyStartTime, continueEditJourney } from '@/utils/journeyTracking';
import uuidv4 from '@/utils/uuid';
import { handleAiAideRoute } from './routes/aiAide';
import { tryFullscreenViewerPaywall, tryPageEditorPaywall } from '@/utils/paywall/mountPaywallGate';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { type MacroTypeValue } from '@/utils/analytics/catalog';
import { NULL_DIAGRAM } from '@/model/Diagram/Diagram';

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

    // Check if this is a global page route (dashboard)
    if (context.extension?.type === 'confluence:globalPage') {
      await handleGetStartedRoute();
      // await import('./dashboard');
      return { macroData: null };
    }

    // Check if this is a content byine item route (AI Aide)
    if (context.extension?.type === 'confluence:contentBylineItem') {
      await handleAiAideRoute();
      return { macroData: null };
    }


    // Initialize context and get macro data (lightweight operations)
    await globals.apWrapper.initializeContext();
    const macroData = await globals.apWrapper.getMacroData();

    // Refresh metrics cache on miss; full collect only on save (Persistence.ts)
    macroMetrics.getMacroMetrics().catch(e => console.error('Error refreshing metrics cache:', e));

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

    // Skip loading heavy components if this is a global settings or global page context
    if (['confluence:globalSettings', 'confluence:globalPage', 'confluence:contentBylineItem'].includes(context.extension?.type)) {
      console.log('Skipping heavy components load for global context');
      return;
    }

    let doc;
    const customContentId = context.extension?.config?.customContentId || context.extension.modal?.customContentId;
    if(!customContentId) {
      doc = {
        diagramType: DiagramType.Sequence,
        code: Example.Sequence,
        mermaidCode: Example.Mermaid,
        plantUmlCode: Example.PlantUml,
        isNew: true
      }
    } else {
      const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
      console.debug('Loaded custom content', customContent);
      doc = customContent?.value;
    }

    // Backfill default PlantUML DSL for existing diagrams created before PlantUML support
    if (!doc.plantUmlCode) {
      doc = { ...doc, plantUmlCode: Example.PlantUml };
    }

    // Start journey tracking for editor mode
    const editable = await isEditorMode();
    if (editable) {
      const macroUuid = context.extension?.config?.uuid || uuidv4();
      const isDialog = !!context.extension?.modal;
      const isMacroConfig = !!context.extension?.macro?.isConfiguring || !!context.extension?.macro?.isInserting;
      
      if (isDialog || isMacroConfig) {
        // Check if journey was passed from parent (for modals opened from viewer)
        const modalContext = context.extension?.modal;
        if (isDialog && modalContext?.journey_id) {
          continueEditJourney(modalContext.journey_id, macroUuid, modalContext.journey_start_time);
        } else {
          const source = isMacroConfig ? 'macro' : 'dialog';
          startEditJourney(macroUuid, source);
        }
      }
      
      // Ensure session is initialized
      getOrCreateSession();
    }

    // Hide skeleton loader before mounting the actual content
    const skeletonLoader = document.getElementById('skeleton-loader');
    if (skeletonLoader) {
      skeletonLoader.style.display = 'none';
    }

    const isSequence = context.moduleKey.startsWith('zenuml-sequence-macro') || context.moduleKey.startsWith('gpt-diagram-macro') || context.extension.modal?.diagramType === 'sequence' || context.extension.modal?.diagramType === 'mermaid';
    const isGraph = context.moduleKey.startsWith('zenuml-graph-macro');
    const isEmbed = context.moduleKey.startsWith('zenuml-embed-macro');

    if(isSequence) {
      const macroKind = (doc?.diagramType === DiagramType.Mermaid || context.extension.modal?.diagramType === 'mermaid') ? 'mermaid' : 'sequence';
      const fullscreenMode = await isFullscreenMode();

      // Editor paywall: mount Workspace under PaywallGate so the iframe is
      // never blank; save remains gated in the persistence layer.
      if (editable) {
        // @ts-ignore - Workspace's Split() helper checks window.split
        window.split = true;
        const Workspace = (await import('@/components/Workspace.vue')).default;
        if (await tryPageEditorPaywall({
          // @ts-ignore - doc may be a partial spread type; matches the happy-path mount below
          doc: doc ?? NULL_DIAGRAM,
          content: Workspace,
          contentProps: { autoResize: !fullscreenMode },
          macroKind,
          customContentId,
        })) return;
      }

      // Fullscreen viewer paywall: blocking modal over the read-only diagram.
      // Fires only when the user clicked Fullscreen on a saturated Lite space.
      if (!editable && fullscreenMode) {
        const DiagramPortal = (await import('@/components/DiagramPortal.vue')).default;
        if (await tryFullscreenViewerPaywall({
          // @ts-ignore - doc may be a partial spread type; matches the happy-path mount below
          doc,
          content: DiagramPortal,
          contentProps: { autoResize: false },
          macroKind,
        })) return;
      }

      const component = editable
      ? (await import("@/components/Workspace.vue")).default
      : (await import("@/components/DiagramPortal.vue")).default;

      //@ts-ignore
      mountRoot(doc, component, { autoResize: !editable && !fullscreenMode });

      if (!editable) {
        trackAnalyticsEvent("macro_viewed", {
          feature_area: "macro",
          surface: "viewer",
          macro_type: doc.diagramType,
          entry_point: "page_view",
        });
      } else {
        const isNew = !customContentId;
        const macroType: MacroTypeValue = (doc?.diagramType as MacroTypeValue) || 'sequence';
        if (isNew) {
          trackAnalyticsEvent("macro_create_started", {
            feature_area: "macro",
            surface: "editor",
            macro_type: macroType,
            entry_point: "page_editor",
          });
        } else {
          trackAnalyticsEvent("macro_edit_opened", {
            feature_area: "macro",
            surface: "editor",
            macro_type: macroType,
            entry_point: "macro_toolbar",
          });
        }
      }
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

// Connect-era 'diagramLoaded' resize handler removed: the host-iframe resize
// bridge call has no @forge/bridge equivalent (Custom UI iframes auto-size),
// so the handler was a silent no-op in pure Forge.

// Dynamically import createAttachmentIfContentChanged only when needed
const createAttachmentIfContentChangedPromise = import("@/model/Attachment").then(
  module => module.default
);

async function createAttachment(code: string, diagramType: DiagramType) {
  try {
    if (globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()) {
      const createAttachmentIfContentChanged = await createAttachmentIfContentChangedPromise;
      await createAttachmentIfContentChanged(code, diagramType);
    } else {
      console.debug("Attachment will no be created as it's not in view mode or the user is unauthorized to edit.");
    }
  } catch (e) {
    // Do not re-throw the error
    console.error("Error when creating attachment", e);

    // Improved error tracking with more detailed information
    let errorDetails: any = { message: e instanceof Error ? e.message : serializeError(e) };

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

EventBus.$on('edit', async(params: any) => {
  const context = await initForgeContext();
  const macroUuid = context.extension?.config?.uuid || uuidv4();
  // Forward the macro's customContentId so the modal can load the right diagram
  // and the pre-edit paywall gate can fire. Without this the modal opens a blank
  // new diagram and the paywall check is skipped entirely.
  const customContentId = context.extension?.config?.customContentId;
  const journeyId = startEditJourney(macroUuid, 'dialog');
  const journeyStartTime = getEditJourneyStartTime();
  
  await openModal({
    resource: 'main',
    onClose: (payload: any) => {
      console.log('onClose called with', payload);
      endEditJourney('cancelled');
      location.reload();
    },
    size: 'fullscreen',
    context: {
      macroMode: 'editor',
      ...(customContentId && { customContentId }),
      journey_id: journeyId,
      journey_start_time: journeyStartTime,
      macro_uuid: macroUuid,
      session_id: getOrCreateSession(),
      ...params
    },
  });
});


// Install the singleton "Restore unsaved changes" banner. It listens for
// 'draft-available' on EventBus and renders a fixed-position banner at the
// top of the page; each editor's mount logic emits the event on reopen.
import { installRestoreDraftBanner } from '@/utils/restoreDraftBanner';
installRestoreDraftBanner();

EventBus.$on('save', async () => {
  console.log('save', store.state.diagram);

  const isNewSequence = !store.state.diagram.id && store.state.diagram.diagramType === "sequence"
  store.state.diagram.isNew = false;

  let id: string;
  try {
    id = await saveToPlatform(store.state.diagram);
  } catch (error) {
    console.error('save failed', error);
    trackEvent('save_failed', 'save_failed', 'error', {
      error_message: String((error as any)?.message || error).substring(0, 500),
      http_status: (error as any)?.status || (error as any)?.statusCode || 'unknown',
    });
    toast({ message: 'Failed to save. Please try again.', duration: 5000 });
    // Do NOT close the dialog — let the user retry
    return;
  }

  // Notify editors so they can clear their localStorage drafts now that the
  // diagram is durably persisted.
  EventBus.$emit('saved', id);

  const preservedTheme = sessionStorage.getItem(`${location.hostname}-preserve-zenuml-conf-theme`);
  if (isNewSequence && preservedTheme) {
    sessionStorage.removeItem(`${location.hostname}-preserve-zenuml-conf-theme`);
    localStorage.setItem(`${location.hostname}-${id}-zenuml-conf-theme`, preservedTheme);
  }

  // End journey on save
  if (getEditJourneyId()) {
    endEditJourney('saved');
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
  
  // Prepare event data
  const isNewSequence = !store.state.diagram.id && store.state.diagram.diagramType === DiagramType.Sequence;
  const elapsedTimeMs = Date.now() - editorStartTime;
  
  const eventProps = {
    had_changes: showWarning,
    source: 'editor',
    elapsed_time_ms: elapsedTimeMs,
    code_length: store.state.diagram.code?.length || 0,
    journey_id: getEditJourneyId(),
    session_id: getOrCreateSession(),
  };
  
  if (showWarning) {
    // Show custom modal dialog for Forge
    const result = await showCloseWithoutSavingDialog();
    
    if (result === 'discard') {
      // User confirmed exit - track exit event
      const exitEventAction = isNewSequence ? 'create_macro_exit' : 'edit_macro_exit';
      trackEvent('', exitEventAction, DiagramType.Sequence, eventProps);
      
      // End journey on exit
      if (getEditJourneyId()) {
        endEditJourney('cancelled');
      }
      
      await (await getView()).close();
    } else {
      // User cancelled exit (chose to keep editing) - track cancelled event
      const cancelledEventAction = isNewSequence ? 'create_macro_exit_cancelled' : 'edit_macro_exit_cancelled';
      trackEvent('', cancelledEventAction, DiagramType.Sequence, eventProps);
      // Do NOT end journey - user continues editing
    }
  } else {
    // No changes - immediate exit
    const exitEventAction = isNewSequence ? 'create_macro_exit' : 'edit_macro_exit';
    trackEvent('', exitEventAction, DiagramType.Sequence, eventProps);
    
    // End journey on exit
    if (getEditJourneyId()) {
      endEditJourney('window_close');
    }
    
    await (await getView()).close();
  }
});



EventBus.$on('fullscreen', async () => {
  const context = await initForgeContext();
  const macroUuid = context.extension?.config?.uuid || uuidv4();

  await openModal({
    resource: 'main',
    onClose: (payload: any) => {
      console.log('onClose called with', payload);
      location.reload();
    },
    size: 'fullscreen',
    context: {
      macroMode: 'fullscreen',
      macro_uuid: macroUuid,
      session_id: getOrCreateSession(),
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


