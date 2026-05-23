import globals from "@/model/globals";
import forgeGlobal, { getView, getContext as initForgeContext, isInserting } from './model/globals/forgeGlobal';
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

// Captured at editor open from extension.config.uuid; forwarded back through
// view.submit's replace-semantics so Connect-era guestParams.uuid survives.
let originalConfigUuid: string | undefined;

async function saveEmbedAndExit(_customContentId: string) {
  const macroData = await globals.apWrapper.getMacroData();

  const id = await saveToPlatform({
    diagramType: DiagramType.Embed,
    source: DataSource.CustomContent,
  } as Diagram);

  const isNew = !macroData?.uuid;

  // Tag analytics with the just-saved customContent id; relying on central
  // Forge-context enrichment here would record the stale source id on copies
  // and null on first saves (context not yet refreshed).
  const savedIdProps = {
    content_id: id,
    custom_content_id: id,
    attachment_name: `zenuml-${id}.png`,
  };

  if (isNew) {
    trackAnalyticsEvent("macro_create_succeeded", {
      feature_area: "macro",
      surface: "editor",
      macro_type: "embed",
      operation_mode: "create",
      ...savedIdProps,
    });
  } else {
    trackAnalyticsEvent("macro_save_succeeded", {
      feature_area: "macro",
      surface: "editor",
      macro_type: "embed",
      operation_mode: "edit",
      ...savedIdProps,
    });
  }
  
  // End journey after all tracking is done
  if (getEditJourneyId()) {
    endEditJourney('saved');
  }
  
  // NOTE: Embed has a separate, pre-existing bug where saveToPlatform is
  // called with no selected content id (the _customContentId parameter is
  // ignored) and always POSTs an empty {diagramType:Embed} record. Applying
  // the cross-page-copy writeback pattern here would repoint the macro at
  // that empty record. Embed needs its own fix that submits the selected
  // content id (or a clone) instead of an empty placeholder. Out of scope
  // for the cross-page-copy fix; see follow-up.
  setTimeout(async () => {
    if(await isInserting()) {
      await (await getView()).submit({config: {
        customContentId: id,
        updatedAt: new Date().toISOString(),
        ...(originalConfigUuid && { uuid: originalConfigUuid }),
      }});
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

  originalConfigUuid = context.extension?.config?.uuid;

  // Start journey tracking
  const macroUuid =
    forgeGlobal.forgeContext?.localId
    || context.extension?.config?.uuid
    || uuidv4();
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