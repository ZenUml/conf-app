import globals from "@/model/globals";
import forgeGlobal, { getView, getContext as initForgeContext, isInserting } from './model/globals/forgeGlobal';
import { saveToPlatform } from "@/model/ContentProvider/Persistence";
import { decompress } from "@/utils/compress";
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import ApWrapper2 from "@/model/ApWrapper2";
import MacroUtil from "@/model/MacroUtil";
import { trackEvent } from "@/utils/window";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { mountRoot } from "@/mount-root";
import { installRestoreDraftBanner } from "@/utils/restoreDraftBanner";
import ForgeGraphEditor from "@/components/DrawIoExtension/ForgeGraphEditor.vue";

installRestoreDraftBanner();
import { Diagram, DiagramType, DataSource, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import store from "@/model/store2";
import { showCloseWithoutSavingDialog } from './utils/modalService';
import EventBus from "./EventBus";
import { startEditJourney, endEditJourney, getOrCreateSession, getEditJourneyId, continueEditJourney } from '@/utils/journeyTracking';
import uuidv4 from '@/utils/uuid';
import { tryPageEditorPaywall } from '@/utils/paywall/mountPaywallGate';
import { reportOrphanObserved, reportOrphanMacroRepaired } from '@/utils/orphanTelemetry';

// Track editor session start time
const editorStartTime = Date.now();

// Captured at editor open from extension.config.uuid. On Connect-era macros
// this is a pre-existing identifier we forward back through view.submit so the
// replace-semantics of {config: …} doesn't wipe the historical breadcrumb.
// Fresh inserts have no value to preserve, so this stays undefined and the
// spread below contributes nothing.
let originalConfigUuid: string | undefined;

// ZEN-1170 Defect 2b: captured at editor open so the save callback can detect
// when the persisted id differs from the macro's stale config id and repair
// the macro XML via view.submit({config:...}).
let originalCustomContentId: string | undefined;
let recoveryPageId: string | undefined;

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

  // Captured before save. If the returned id differs from sourceId, the save
  // forked a new custom content (cross-page-copy / same-page-duplicate path)
  // and the macro params must be rewritten via view.submit, else the page
  // still points at the source content while the new one sits orphaned.
  // The truthy-guard is load-failure protection (NULL_DIAGRAM fallback).
  const sourceId = diagram?.id ? String(diagram.id) : '';

  const id = await saveToPlatform(diagram);

  // End journey on save
  if (getEditJourneyId()) {
    endEditJourney('saved');
  }

  // ZEN-1170 Defect 2b: repair stale macro XML when we saved against the
  // recovered sibling id.
  const macroNeedsRepair = !!(originalCustomContentId && id && id !== originalCustomContentId);

  setTimeout(async () => {
    const idChanged = !!sourceId && !!id && id !== sourceId;
    const needsWriteback = (await isInserting()) || idChanged || macroNeedsRepair;
    try {
      if (needsWriteback) {
        await (await getView()).submit({config: {
          customContentId: id,
          updatedAt: new Date().toISOString(),
          ...(originalConfigUuid && { uuid: originalConfigUuid }),
        }});
        if (macroNeedsRepair && originalCustomContentId) {
          reportOrphanMacroRepaired(recoveryPageId, originalCustomContentId, id, 'graph');
        }
      } else {
        await (await getView()).close();
      }
      // Notify draft listeners (ForgeGraphEditor.vue subscribes to 'saved')
      // only after the macro state is durable. If submit throws below, the
      // local draft survives as a retry anchor.
      EventBus.$emit('saved', id);
    } catch (error) {
      console.error('view.submit/close failed after graph save', error);
      trackEvent('save_failed', 'view_submit_failed', 'error', {
        error_message: String((error as any)?.message || error).substring(0, 500),
        new_custom_content_id: id,
        writeback_required: String(needsWriteback),
        macro_type: 'graph',
      });
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

  // Snapshot the legacy guestParams.uuid (if any) so saveGraphAndExit can
  // forward it back through view.submit's replace-semantics.
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
  originalCustomContentId = customContentId;
  recoveryPageId = context.extension?.content?.id;

  let doc: Diagram | undefined;
  if (!customContentId) {
    doc = {
      diagramType: DiagramType.Graph,
      graphXml: EMPTY_GRAPH,
      isNew: true,
    } as Diagram;
  } else {
    const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(recoveryPageId, customContentId);
    console.log('loadDiagram - customContent', loaded.customContent, 'recoveredFromOrphan?', loaded.recoveredFromOrphanId);
    doc = loaded.customContent?.value;
    if (loaded.recoveredFromOrphanId && doc) {
      reportOrphanObserved(recoveryPageId, customContentId, 'graph', loaded.probeResult, {
        recoveryUsed: true,
        recoveredId: loaded.customContent?.id != null ? String(loaded.customContent.id) : undefined,
      });
    } else if (!doc) {
      reportOrphanObserved(recoveryPageId, customContentId, 'graph', loaded.probeResult, { recoveryUsed: false });
    }
  }

  store.state.diagram = doc ?? NULL_DIAGRAM;
  window.diagram = doc ?? NULL_DIAGRAM;
  console.log('loadDiagram - window.diagram', window.diagram);

  let graphXml = doc?.graphXml;
  if (doc?.compressed) {
    trackEvent('compressed_field_editor', 'load', 'warning');
    if (!graphXml?.startsWith('<mxGraphModel')) {
      graphXml = decompress(doc.graphXml);
      trackEvent('compressed_content_editor', 'load', 'warning');
    }
  }

  if (graphXml) {
    // @ts-ignore
    window.graphXml = graphXml;
  }

  const contentProps = { graphXml, saveGraphAndExit, doc, customContentId };
  const paywalled = await tryPageEditorPaywall({
    doc: doc ?? NULL_DIAGRAM,
    content: ForgeGraphEditor,
    contentProps,
    macroKind: 'graph',
    customContentId,
  });
  if (!paywalled) {
    mountRoot(doc ?? NULL_DIAGRAM, ForgeGraphEditor, contentProps);
  }

  const isNew = await MacroUtil.isCreateNew();
  trackAnalyticsEvent(isNew ? 'macro_create_started' : 'macro_edit_opened', {
    feature_area: 'macro',
    surface: 'editor',
    macro_type: 'graph',
    entry_point: isNew ? 'page_editor' : 'macro_toolbar',
  });
}

export default initializeMacro(); 