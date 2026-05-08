import globals from "@/model/globals";
import { getView, getContext as initForgeContext, isInserting } from './model/globals/forgeGlobal';
import { saveToPlatform } from "@/model/ContentProvider/Persistence";
import { decompress } from "@/utils/compress";
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import ApWrapper2 from "@/model/ApWrapper2";
import MacroUtil from "@/model/MacroUtil";
import { trackEvent } from "@/utils/window";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { mountRoot } from "@/mount-root";
import ForgeGraphEditor from "@/components/DrawIoExtension/ForgeGraphEditor.vue";
import { Diagram, DiagramType, DataSource, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import store from "@/model/store2";
import { showCloseWithoutSavingDialog } from './utils/modalService';
import EventBus from "./EventBus";
import { startEditJourney, endEditJourney, getOrCreateSession, getEditJourneyId, continueEditJourney } from '@/utils/journeyTracking';
import uuidv4 from '@/utils/uuid';
import { useCustomerSuccessService, MACROS_LIMIT, getUpgradeContext } from '@/composables/useCustomerSuccessService';
import { isPageEditorEditBlocked } from '@/utils/paywall/preEditGate';
import { trackUpgradeEvent, UpgradeEventName, UIComponent } from '@/utils/upgradeTracking';
import PageEditorPaywallGate from '@/components/UpgradePrompt/PageEditorPaywallGate.vue';

// Track editor session start time
const editorStartTime = Date.now();

const EMPTY_GRAPH = `<mxfile>
  <diagram name="Page-1">
    <mxGraphModel dx="1434" dy="540" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

async function saveGraphAndExit(graphXml: string) {
  const diagram = {
    ...window.diagram,
    graphXml,
    diagramType: DiagramType.Graph,
    source: DataSource.CustomContent
  };
  
  const id = await saveToPlatform(diagram);
  
  // End journey on save
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
  const codeChanged = window.diagram?.graphXml !== window.graphXml;
  
  // Prepare event data
  const isNewGraph = !store.state.diagram.id && store.state.diagram.diagramType === DiagramType.Graph;
  const elapsedTimeMs = Date.now() - editorStartTime;
  
  const eventProps = {
    had_changes: codeChanged,
    source: 'graph_editor',
    elapsed_time_ms: elapsedTimeMs,
    code_length: store.state.diagram.graphXml?.length || 0,
    journey_id: getEditJourneyId(),
    session_id: getOrCreateSession(),
  };
  
  if (codeChanged) {
    // Show custom modal dialog for Forge
    const result = await showCloseWithoutSavingDialog();
    
    if (result === 'discard') {
      // User confirmed exit - track exit event
      const exitEventAction = isNewGraph ? 'create_macro_exit' : 'edit_macro_exit';
      trackEvent('', exitEventAction, DiagramType.Graph, eventProps);
      
      // End journey on exit
      if (getEditJourneyId()) {
        endEditJourney('cancelled');
      }
      
      await (await getView()).close();
    } else {
      // User cancelled exit (chose to keep editing) - track cancelled event
      const cancelledEventAction = isNewGraph ? 'create_macro_exit_cancelled' : 'edit_macro_exit_cancelled';
      trackEvent('', cancelledEventAction, DiagramType.Graph, eventProps);
      // Do NOT end journey - user continues editing
    }
  } else {
    // No changes - immediate exit
    const exitEventAction = isNewGraph ? 'create_macro_exit' : 'edit_macro_exit';
    trackEvent('', exitEventAction, DiagramType.Graph, eventProps);
    
    // End journey on exit
    if (getEditJourneyId()) {
      endEditJourney('window_close');
    }
    
    await (await getView()).close();
  }
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

  const mountEditor = async () => {
    let doc: Diagram | undefined;
    if(!customContentId) {
      doc = {
        diagramType: DiagramType.Graph,
        graphXml: EMPTY_GRAPH,
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

    let graphXml = doc?.graphXml;
    if (doc?.compressed) {
      trackEvent("compressed_field_editor", "load", "warning");
      if (!graphXml?.startsWith("<mxGraphModel")) {
        graphXml = decompress(doc.graphXml);
        trackEvent("compressed_content_editor", "load", "warning");
      }
    }

    if (graphXml) {
      // @ts-ignore
      window.graphXml = graphXml;
    }

    mountRoot(doc ?? NULL_DIAGRAM, ForgeGraphEditor, {
      graphXml,
      saveGraphAndExit,
      doc
    });

    // Track begin event (create or edit)
    const isNew = await MacroUtil.isCreateNew();
    if (isNew) {
      trackAnalyticsEvent("macro_create_started", {
        feature_area: "macro",
        surface: "editor",
        macro_type: "graph",
        entry_point: "page_editor",
      });
    } else {
      trackAnalyticsEvent("macro_edit_opened", {
        feature_area: "macro",
        surface: "editor",
        macro_type: "graph",
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

    mountRoot(NULL_DIAGRAM, PageEditorPaywallGate, {
      macrosCreated: customerSuccess.macrosCreated.value,
      macrosLimit: MACROS_LIMIT,
      upgradeUrl: customerSuccess.upgradeUrl.value,
      enterpriseBundleUrl: customerSuccess.enterpriseBundleUrl.value,
      macroKind: 'graph',
      spaceKey,
      onContinueEditing: () => {
        void mountEditor();
      },
    });
    return;
  }

  await mountEditor();
}

export default initializeMacro(); 