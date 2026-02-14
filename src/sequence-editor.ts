import ApWrapper2 from "@/model/ApWrapper2";
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import globals from "@/model/globals";

import Workspace from './components/Workspace.vue'
import { mountRoot } from "@/mount-root";

import store from './model/store2'
import EventBus from './EventBus'
import AP from "@/model/AP";

import { saveToPlatform } from "@/model/ContentProvider/Persistence";
import './utils/IgnoreEsc.ts'

import './assets/tailwind.css'
import { DiagramType, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import Example from "@/utils/sequence/Example";
import { trackEvent } from "@/utils/window";
import MacroUtil from "@/model/MacroUtil";
import { startEditJourney, endEditJourney, getOrCreateSession, getEditJourneyId, continueEditJourney } from '@/utils/journeyTracking';
import { detectEditMode } from '@/utils/editModeDetection';
import uuidv4 from '@/utils/uuid';

// Track editor session start time
const editorStartTime = Date.now();

async function main() {
  await globals.apWrapper.initializeContext();
  
  // Start journey tracking
  const macroData = await globals.apWrapper.getMacroData();
  const macroUuid = macroData?.uuid || uuidv4();
  
  // Check if journey was passed from parent (for dialogs opened from viewer)
  const customData: any = await new Promise((resolve) => {
    try {
      AP.dialog.getCustomData((data: any) => resolve(data));
    } catch (e) {
      resolve(undefined); // Intended to avoid breaking local development access
    }
  });
  
  if (customData?.journey_id) {
    continueEditJourney(customData.journey_id, macroUuid, customData.journey_start_time);
  } else {
    // Start new journey
    const editMode = await detectEditMode(globals.apWrapper);
    if (editMode.source !== 'inline' && editMode.source !== 'unknown') {
      startEditJourney(macroUuid, editMode.source);
    }
  }
  
  // Ensure session is initialized
  getOrCreateSession();
  
  const compositeContentProvider = defaultContentProvider(globals.apWrapper as ApWrapper2);
  let { doc } = await compositeContentProvider.load();
  console.log('loaded document', doc);

  if (doc === NULL_DIAGRAM) {
    console.log('document is null, loading example');
    doc = {
      diagramType: DiagramType.Sequence,
      code: Example.Sequence,
      mermaidCode: Example.Mermaid,
      isNew: true
    }
  }

  mountRoot(doc, Workspace);

  // Track begin event (create or edit)
  const isNew = await MacroUtil.isCreateNew();
  const beginEventAction = isNew ? 'create_macro_begin' : 'edit_macro_begin';
  
  trackEvent('', beginEventAction, DiagramType.Sequence, {
    journey_id: getEditJourneyId(),
    session_id: getOrCreateSession(),
  });
}

// We do not have to export main(), but otherwise IDE shows a warning
export default main();

EventBus.$on('save', async () => {
  const isNewSequence = !store.state.diagram.id && store.state.diagram.diagramType === DiagramType.Sequence
  store.state.diagram.isNew = false;
  const id = await saveToPlatform(store.state.diagram);
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
  setTimeout(() => {
    // @ts-ignore
    AP.dialog.close();
  }, 500);
});

EventBus.$on('exit', async (showWarning: boolean) => {
  console.log('exit', showWarning);
  
  // Prepare event data
  const isNewSequence = !store.state.diagram.id && store.state.diagram.diagramType === DiagramType.Sequence;
  const elapsedTimeMs = Date.now() - editorStartTime;
  
  const eventProps = {
    had_changes: showWarning,
    source: 'editor_dialog',
    elapsed_time_ms: elapsedTimeMs,
    code_length: store.state.diagram.code?.length || 0,
    journey_id: getEditJourneyId(),
    session_id: getOrCreateSession(),
  };
  
  if (showWarning) {
    // Show confirmation dialog
    AP.dialog.create({
      key: 'zenuml-close-without-saving-dialog',
      width: 500,
      height: 300,
      chrome: false,
    }).on('close', (data: any) => {
      if (data.action === 'discard') {
        // User confirmed exit - track exit event
        const exitEventAction = isNewSequence ? 'create_macro_exit' : 'edit_macro_exit';
        trackEvent('', exitEventAction, DiagramType.Sequence, eventProps);
        
        // End journey on exit
        if (getEditJourneyId()) {
          endEditJourney('cancelled');
        }
        
        AP.dialog.close();
      } else {
        // User cancelled exit (chose to keep editing) - track cancelled event
        const cancelledEventAction = isNewSequence ? 'create_macro_exit_cancelled' : 'edit_macro_exit_cancelled';
        trackEvent('', cancelledEventAction, DiagramType.Sequence, eventProps);
        // Do NOT end journey - user continues editing
      }
    });
  } else {
    // No changes - immediate exit
    const exitEventAction = isNewSequence ? 'create_macro_exit' : 'edit_macro_exit';
    trackEvent('', exitEventAction, DiagramType.Sequence, eventProps);
    
    // End journey on exit
    if (getEditJourneyId()) {
      endEditJourney('window_close');
    }
    
    AP.dialog.close();
  }
});
