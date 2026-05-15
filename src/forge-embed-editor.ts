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
import { useCustomerSuccessService, MACROS_LIMIT, getUpgradeContext } from '@/composables/useCustomerSuccessService';
import { isPageEditorEditBlocked, isPageEditorCreateBlocked } from '@/utils/paywall/preEditGate';
import { trackUpgradeEvent, UpgradeEventName, UIComponent } from '@/utils/upgradeTracking';
import PageEditorPaywallGate from '@/components/UpgradePrompt/PageEditorPaywallGate.vue';

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

  const mountEditor = async (paywallWrap?: Record<string, unknown>) => {
    let doc: Diagram | undefined;
    if(!customContentId) {
      doc = {
        diagramType: DiagramType.Embed,
        isNew: true
      } as Diagram;
    } else {
      const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
      console.log('loadDiagram - customContent', customContent);
      doc = customContent?.value;
    }

    store.state.diagram = doc ?? NULL_DIAGRAM;
    window.diagram = doc ?? NULL_DIAGRAM;
    console.log('loadDiagram - window.diagram', window.diagram);

    const editorProps = { saveEmbedAndExit, exit, doc };
    if (paywallWrap) {
      mountRoot(doc ?? NULL_DIAGRAM, PageEditorPaywallGate, {
        editor: ForgeEmbedEditor,
        editorProps,
        ...paywallWrap,
      });
    } else {
      mountRoot(doc ?? NULL_DIAGRAM, ForgeEmbedEditor, editorProps);
    }

    // Track begin event (create or edit)
    const isNew = await MacroUtil.isCreateNew();
    if (isNew) {
      trackAnalyticsEvent("macro_create_started", {
        feature_area: "macro",
        surface: "editor",
        macro_type: "embed",
        entry_point: "page_editor",
      });
    } else {
      trackAnalyticsEvent("macro_edit_opened", {
        feature_area: "macro",
        surface: "editor",
        macro_type: "embed",
        entry_point: "macro_toolbar",
      });
    }
  };

  const customerSuccess = useCustomerSuccessService();
  await customerSuccess.initialize();

  if (isPageEditorEditBlocked(customContentId, customerSuccess.shouldBlockActions.value)) {
    let spaceKey = '';
    try {
      spaceKey = (await globals.apWrapper.getCurrentSpace())?.key || '';
    } catch (error) {
      console.debug('Could not resolve current space for page-editor paywall gate', error);
    }

    trackUpgradeEvent(UpgradeEventName.PAYWALL_BLOCKED_EDIT, {
      ui_component: UIComponent.VIEWER_NOTICE,
      action_type: 'page_editor',
      ...getUpgradeContext(),
    });

    trackUpgradeEvent(UpgradeEventName.PAYWALL_TRIGGERED, {
      ui_component: UIComponent.VIEWER_NOTICE,
      action_type: 'page_editor',
      ...getUpgradeContext(),
    });

    await mountEditor({
      macrosCreated: customerSuccess.macrosCreated.value,
      macrosLimit: MACROS_LIMIT,
      upgradeUrl: customerSuccess.upgradeUrl.value,
      enterpriseBundleUrl: customerSuccess.enterpriseBundleUrl.value,
      macroKind: 'embed',
      spaceKey,
    });
    return;
  }

  // Pre-create paywall gate: block new-macro creation in saturated spaces
  if (!customContentId && isPageEditorCreateBlocked(customerSuccess.shouldBlockActions.value)) {
    let spaceKey = '';
    try {
      spaceKey = (await globals.apWrapper.getCurrentSpace())?.key || '';
    } catch (error) {
      console.debug('Could not resolve current space for page-editor create paywall gate', error);
    }

    trackUpgradeEvent(UpgradeEventName.PAYWALL_BLOCKED_CREATE, {
      ui_component: UIComponent.VIEWER_NOTICE,
      action_type: 'page_editor_create',
      ...getUpgradeContext(),
    });

    trackUpgradeEvent(UpgradeEventName.PAYWALL_TRIGGERED, {
      ui_component: UIComponent.VIEWER_NOTICE,
      action_type: 'page_editor_create',
      ...getUpgradeContext(),
    });

    await mountEditor({
      macrosCreated: customerSuccess.macrosCreated.value,
      macrosLimit: MACROS_LIMIT,
      upgradeUrl: customerSuccess.upgradeUrl.value,
      enterpriseBundleUrl: customerSuccess.enterpriseBundleUrl.value,
      macroKind: 'embed',
      spaceKey,
    });
    return;
  }

  await mountEditor();
}


export default initializeMacro(); 