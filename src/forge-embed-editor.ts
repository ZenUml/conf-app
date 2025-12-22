import globals from "@/model/globals";
import { getView, getContext as initForgeContext, isConfiguring, isInserting } from './model/globals/forgeGlobal';
import { saveToPlatform } from "@/model/ContentProvider/Persistence";
import MacroUtil from "@/model/MacroUtil";
import { trackEvent } from "@/utils/window";
import { mountRoot } from "@/mount-root";
import ForgeEmbedEditor from "@/components/DrawIoExtension/ForgeEmbedEditor.vue";
import { DiagramType, DataSource } from "@/model/Diagram/Diagram";
import store from "@/model/store2";
import uuidv4 from "@/utils/uuid";
import EventBus from "./EventBus";
import { startEditJourney, endEditJourney, getOrCreateSession, getEditJourneyId, continueEditJourney } from '@/utils/journeyTracking';

// Type declarations for global window properties
declare global {
  interface Window {
    diagram: any;
    picked?: any;
  }
}

async function saveEmbedAndExit(customContentId: string) {
  const macroData = await globals.apWrapper.getMacroData();
  const uuid = macroData?.uuid || uuidv4();
  
  const params = { 
    uuid, 
    customContentId: customContentId, 
    updatedAt: new Date().toISOString() 
  };
  
  const id = await saveToPlatform({
    diagramType: DiagramType.Embed,
    source: DataSource.CustomContent,
    customContentId: customContentId
  });
  
  // Split into create_macro_end and edit_macro_end
  const isNew = !macroData?.uuid;
  const endEventAction = isNew ? 'create_macro_end' : 'edit_macro_end';
  
  trackEvent(uuid, endEventAction, 'embed', {
    journey_id: getEditJourneyId(),
    session_id: getOrCreateSession(),
  });
  
  // End journey after all tracking is done
  if (getEditJourneyId()) {
    endEditJourney('saved');
  }
  
  setTimeout(async () => {
    if(await isInserting()) {
      await (await getView()).submit({config: {customContentId: id, updatedAt: new Date().toISOString()}});
    } else {
      await (await getView()).close();
    }
  }, 500);
}

async function exit() {
  await (await getView()).close();
}

async function initializeMacro() {
  const context = await initForgeContext();
  
  // Start journey tracking
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

  let doc;
  const customContentId = context.extension?.config?.customContentId;
  if(!customContentId) {
    doc = {
      diagramType: DiagramType.Embed,
      isNew: true
    }
  } else {
    const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
    console.log('loadDiagram - customContent', customContent);
    doc = customContent?.value;
  }

  store.state.diagram = doc || {};
  window.diagram = doc || {};
  console.log('loadDiagram - window.diagram', window.diagram);

  mountRoot(doc, ForgeEmbedEditor, {
    saveEmbedAndExit,
    exit,
    doc
  });

  // Track begin event (create or edit)
  const isNew = await MacroUtil.isCreateNew();
  const beginEventAction = isNew ? 'create_macro_begin' : 'edit_macro_begin';
  
  trackEvent("", beginEventAction, "embed", {
    journey_id: getEditJourneyId(),
    session_id: getOrCreateSession(),
  });
}


EventBus.$on('save-embed', async (customContent: any) => {
  console.log('forge-embed-editor - save', customContent);
  // Give some time for track event to be sent out. We are not using a more reliable way to track event because
  // we don't want to block dialog close for too long.
  setTimeout(async () => {
    if(await isConfiguring() || await isInserting()) {
      await (await getView()).submit({config: {customContentId: customContent.id, updatedAt: new Date().toISOString()}});
    } else {
      await (await getView()).close();
    }
  }, 500);
});

export default initializeMacro(); 