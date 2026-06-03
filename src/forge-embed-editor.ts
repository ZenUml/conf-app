import globals from "@/model/globals";
import forgeGlobal, { getView, getContext as initForgeContext } from './model/globals/forgeGlobal';
import MacroUtil from "@/model/MacroUtil";
import { trackEvent } from "@/utils/window";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { markCsatPending } from "@/utils/csat";
import { mountRoot } from "@/mount-root";
import { installRestoreDraftBanner } from "@/utils/restoreDraftBanner";
import ForgeEmbedEditor from "@/components/DrawIoExtension/ForgeEmbedEditor.vue";
import EventBus from './EventBus';

installRestoreDraftBanner();
import { Diagram, DiagramType, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import store from "@/model/store2";
import uuidv4 from "@/utils/uuid";
import { startEditJourney, endEditJourney, getOrCreateSession, getEditJourneyId, continueEditJourney } from '@/utils/journeyTracking';
import { tryPageEditorPaywall } from '@/utils/paywall/mountPaywallGate';
import { markRecentMacroActivity } from '@/utils/paywall/warningBanner';

// Captured at editor open from extension.config.uuid; forwarded back through
// view.submit's replace-semantics so Connect-era guestParams.uuid survives.
let originalConfigUuid: string | undefined;

async function saveEmbedAndExit(selectedCustomContentId: string) {
  // Embed save = point the macro at the user's picked document. No new
  // customContent record is created. The picked CC's body (its native
  // diagramType + code/graphXml/mermaidCode) is what the embed viewer
  // dispatches on. Connect-era behaviour was the same: saveMacro({
  // customContentId: window.picked.id, ... }) referenced the picked
  // record directly.
  //
  // Bug history (ZEN-125): a TS strictness pass on 2026-03-26 (3fddbcc2)
  // dropped the customContentId field while silencing `as Diagram`, then
  // 2026-04-27 (810d513d) renamed the orphaned parameter to start with `_`
  // to silence the unused-arg lint warning — which made the bug look
  // intentional in source. Result was every embed save POSTed an empty
  // {diagramType:"embed",source:"custom-content"} placeholder, and the
  // viewer rendered "Unknown diagram type: embed".
  const macroData = await globals.apWrapper.getMacroData();
  const isNew = !macroData?.uuid;

  const savedIdProps = {
    content_id: selectedCustomContentId,
    custom_content_id: selectedCustomContentId,
    attachment_name: `zenuml-${selectedCustomContentId}.png`,
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
    markCsatPending();
  }

  if (getEditJourneyId()) {
    endEditJourney('saved');
  }

  setTimeout(async () => {
    try {
      await (await getView()).submit({config: {
        customContentId: selectedCustomContentId,
        updatedAt: new Date().toISOString(),
        ...(originalConfigUuid && { uuid: originalConfigUuid }),
      }});
      markRecentMacroActivity(isNew ? 'create' : 'edit');
      // Notify listeners after the macro state is durable; on submit
      // failure the catch path intentionally does NOT emit so any local
      // draft survives as a retry anchor.
      EventBus.$emit('saved', selectedCustomContentId);
    } catch (error) {
      console.error('view.submit failed after embed save', error);
      trackEvent('save_failed', 'view_submit_failed', 'error', {
        error_message: String((error as any)?.message || error).substring(0, 500),
        selected_custom_content_id: selectedCustomContentId,
        macro_type: 'embed',
      });
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
  if (customContentId) {
    const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
    console.log('loadDiagram - customContent', customContent);
    doc = customContent?.value;
  }

  // ZEN-1170 Defect 1 sibling (PR #139): cross-page-paste recovery via
  // uuid → CC title. Mirrors the embed viewer fallback so an Edit click on
  // a recovered embed doesn't open a blank editor that would silently wipe
  // the diagram the viewer is showing on first save. Runs before the
  // isNew=true default so we don't shadow a real recovered diagram.
  if (!doc) {
    const storageUuid = context.extension?.config?.uuid;
    if (storageUuid) {
      const recovered = await globals.apWrapper.findLegacyCustomContentByUuid(storageUuid);
      if (recovered?.value) {
        doc = recovered.value;
        doc.recoveredFromOrphan = true;
        trackEvent(storageUuid, 'legacy_custom_content_by_uuid_restored', 'info', {
          surface: 'editor',
          macro_type: 'embed',
          recovered_id: String(recovered.id ?? ''),
          is_copy: doc.isCopy ? 'true' : 'false',
          ...(context.extension?.content?.id && { page_id: context.extension.content.id }),
        });
      }
    }
  }

  if (!doc) {
    doc = { diagramType: DiagramType.Embed, isNew: true } as Diagram;
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
