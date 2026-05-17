import globals from "@/model/globals";
import { getView, getContext as initForgeContext, isInserting } from './model/globals/forgeGlobal';
import { saveToPlatform } from "@/model/ContentProvider/Persistence";
import MacroUtil from "@/model/MacroUtil";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { mountRoot } from "@/mount-root";
import { installRestoreDraftBanner } from "@/utils/restoreDraftBanner";
import ForgeEmbedEditor from "@/components/DrawIoExtension/ForgeEmbedEditor.vue";

installRestoreDraftBanner();
import { Diagram, DiagramType, DataSource, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import store from "@/model/store2";
import uuidv4 from "@/utils/uuid";
import { startEditJourney, endEditJourney, getOrCreateSession, getEditJourneyId, continueEditJourney } from '@/utils/journeyTracking';
import { tryPageEditorPaywall } from '@/utils/paywall/mountPaywallGate';

async function saveEmbedAndExit(_customContentId: string) {
  const macroData = await globals.apWrapper.getMacroData();

  const id = await saveToPlatform({
    diagramType: DiagramType.Embed,
    source: DataSource.CustomContent,
  } as Diagram);
  
  const isNew = !macroData?.uuid;

  if (isNew) {
    trackAnalyticsEvent("macro_create_succeeded", {
      feature_area: "macro",
      surface: "editor",
      macro_type: "embed",
      operation_mode: "create",
    });
  } else {
    trackAnalyticsEvent("macro_save_succeeded", {
      feature_area: "macro",
      surface: "editor",
      macro_type: "embed",
      operation_mode: "edit",
    });
  }
  
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
  const customContentId = context.extension?.config?.customContentId;

  let doc: Diagram | undefined;
  if (!customContentId) {
    doc = { diagramType: DiagramType.Embed, isNew: true } as Diagram;
  } else {
    const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
    console.log('loadDiagram - customContent', customContent);
    doc = customContent?.value;
  }

  store.state.diagram = doc ?? NULL_DIAGRAM;
  window.diagram = doc ?? NULL_DIAGRAM;
  console.log('loadDiagram - window.diagram', window.diagram);

  const contentProps = { saveEmbedAndExit, exit, doc };
  const paywalled = await tryPageEditorPaywall({
    doc: doc ?? NULL_DIAGRAM,
    content: ForgeEmbedEditor,
    contentProps,
    macroKind: 'embed',
    customContentId,
  });
  if (!paywalled) {
    mountRoot(doc ?? NULL_DIAGRAM, ForgeEmbedEditor, contentProps);
  }

  const isNew = await MacroUtil.isCreateNew();
  trackAnalyticsEvent(isNew ? 'macro_create_started' : 'macro_edit_opened', {
    feature_area: 'macro',
    surface: 'editor',
    macro_type: 'embed',
    entry_point: isNew ? 'page_editor' : 'macro_toolbar',
  });
}


export default initializeMacro(); 