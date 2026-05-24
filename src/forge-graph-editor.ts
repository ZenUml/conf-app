import globals from "@/model/globals";
import forgeGlobal, { getView, getContext as initForgeContext, isInserting, isConfiguring } from './model/globals/forgeGlobal';
import { saveToPlatform, LegacyLoadBlockedSaveError } from "@/model/ContentProvider/Persistence";
import { decompress } from "@/utils/compress";
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import ApWrapper2 from "@/model/ApWrapper2";
import MacroUtil from "@/model/MacroUtil";
import { trackEvent } from "@/utils/window";
import { toast } from '@/utils/toast';
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
import {
  reportLegacyContentPropertyRestored,
  reportLegacyContentPropertyLoadFailed,
  reportLegacyContentPropertyValueUnexpected,
  reportLegacyContentPropertyMacroRepaired,
} from '@/utils/legacyContentPropertyTelemetry';

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

  let id: string;
  try {
    id = await saveToPlatform(diagram);
  } catch (error) {
    // ZEN-1170 Defect 1: persistence layer refused save because the legacy
    // content-property load failed. Retry won't help — direct the user to
    // refresh / contact support instead.
    if (error instanceof LegacyLoadBlockedSaveError) {
      toast({
        message: 'Legacy diagram content failed to load — saving is disabled to prevent data loss. Please refresh the page or contact support.',
        duration: 8000,
      });
      return;
    }
    console.error('saveGraphAndExit failed', error);
    trackEvent('save_failed', 'save_failed', 'error', {
      error_message: String((error as any)?.message || error).substring(0, 500),
      http_status: (error as any)?.status || (error as any)?.statusCode || 'unknown',
    });
    toast({ message: 'Failed to save. Please try again.', duration: 5000 });
    // Do NOT end journey, do NOT close — keep editor open so the user can retry.
    return;
  }

  // End journey on save
  if (getEditJourneyId()) {
    endEditJourney('saved');
  }

  // ZEN-1170 Defect 2b: repair stale macro XML when we saved against the
  // recovered sibling id. Only fires in surfaces where view.submit({config})
  // actually persists (insert / isConfiguring). See forgeIndex.ts for the
  // full rationale on viewer-launched modal contexts being a no-op.
  const macroNeedsRepair = !!(originalCustomContentId && id && id !== originalCustomContentId);
  // ZEN-1170 Defect 1: legacy-content-property migration. When the editor
  // mounted a doc loaded from the legacy page content property, the macro
  // XML still has uuid only (no customContentId). originalCustomContentId
  // is therefore undefined, so macroNeedsRepair above is false. Detect this
  // case via window.diagram.source so the same writeback block migrates the
  // macro XML to a CC-backed shape on first save.
  const legacyMacroNeedsRepair = !originalCustomContentId
    && (window.diagram?.source === DataSource.ContentProperty
        || window.diagram?.source === DataSource.ContentPropertyOld);

  setTimeout(async () => {
    const [inserting, configuring] = await Promise.all([isInserting(), isConfiguring()]);
    const repairWillPersist = inserting || configuring;
    const attemptRepair = repairWillPersist && macroNeedsRepair;
    const attemptLegacyMigration = repairWillPersist && legacyMacroNeedsRepair && !!id;
    const idChanged = !!sourceId && !!id && id !== sourceId;
    const needsWriteback = inserting || idChanged || attemptRepair || attemptLegacyMigration;
    try {
      if (needsWriteback) {
        await (await getView()).submit({config: {
          customContentId: id,
          updatedAt: new Date().toISOString(),
          ...(originalConfigUuid && { uuid: originalConfigUuid }),
        }});
        if (attemptRepair && originalCustomContentId) {
          reportOrphanMacroRepaired(recoveryPageId, originalCustomContentId, id, 'graph');
        }
        if (attemptLegacyMigration && originalConfigUuid) {
          reportLegacyContentPropertyMacroRepaired('graph', originalConfigUuid, id, { pageId: recoveryPageId });
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

  // ZEN-1170 Defect 1: storageUuid is the Connect-era macro identity (the key
  // used when legacy content properties were written). NOT the same as
  // forgeGlobal.localId, which is Forge's journey id and never appeared in
  // legacy content-property keys. Conflating the two would query the wrong
  // key, miss the real legacy body, and (after save) overwrite it with
  // EMPTY_GRAPH.
  const storageUuid: string | undefined = context.extension?.config?.uuid;

  let doc: Diagram | undefined;
  let legacyLoadBlocked = false;
  if (customContentId) {
    const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(recoveryPageId, customContentId);
    console.log('loadDiagram - customContent', loaded.customContent, 'recoveredFromOrphan?', loaded.recoveredFromOrphanId);
    doc = loaded.customContent?.value;
    if (loaded.recoveredFromOrphanId && doc) {
      doc.recoveredFromOrphan = true;
      doc.recoveredFromOrphanId = loaded.recoveredFromOrphanId;
      reportOrphanObserved(recoveryPageId, customContentId, 'graph', loaded.probeResult, {
        recoveryUsed: true,
        recoveredId: loaded.customContent?.id != null ? String(loaded.customContent.id) : undefined,
      });
    } else if (!doc) {
      reportOrphanObserved(recoveryPageId, customContentId, 'graph', loaded.probeResult, { recoveryUsed: false });
    }
  }

  // ZEN-1170 Defect 1: try the legacy content-property fallback whenever the
  // custom-content path didn't yield a doc AND a legacy storageUuid exists.
  // Covers BOTH (a) macros with no customContentId (pure legacy), and (b)
  // mixed-state macros (stale customContentId 404s but legacy uuid still
  // points to a real body). On non-404 failure or unexpected value shape,
  // set the sentinel so the persistence layer refuses to save (which would
  // otherwise destructively replace the legacy body with EMPTY_GRAPH).
  if (!doc && storageUuid) {
    const result = await globals.apWrapper.getContentPropertyV2(
      `zenuml-graph-macro-${storageUuid}-body`,
    );
    if (result.status === 'ok') {
      const value = result.property.value;
      if (value && typeof value === 'object') {
        // See forge-graph-viewer.ts: reuse Defect 2b's recoveredFromOrphan
        // flag for UI gating; leave `id` undefined so save creates a fresh
        // CC. The save handler in saveGraphAndExit extends the existing
        // writeback trigger to fire for this no-original-customContentId
        // case (see attemptLegacyMigration below).
        doc = {
          ...(value as Diagram),
          diagramType: DiagramType.Graph,
          source: DataSource.ContentProperty,
          id: undefined,
          recoveredFromOrphan: true,
        };
        reportLegacyContentPropertyRestored('editor', 'graph', storageUuid, { pageId: recoveryPageId });
      } else if (typeof value === 'string') {
        legacyLoadBlocked = true;
        reportLegacyContentPropertyValueUnexpected('editor', 'graph', storageUuid, 'string');
      } else {
        legacyLoadBlocked = true;
        reportLegacyContentPropertyValueUnexpected('editor', 'graph', storageUuid, value == null ? 'null' : 'other');
      }
    } else if (result.status === 'forbidden') {
      legacyLoadBlocked = true;
      reportLegacyContentPropertyLoadFailed('editor', 'graph', storageUuid, 'forbidden', { pageId: recoveryPageId });
    } else if (result.status === 'page_not_found') {
      // The PAGE itself wasn't reachable — we don't actually know whether
      // the key exists. Fail closed: never let the editor mount a fresh
      // placeholder and save over a legacy body we couldn't probe.
      legacyLoadBlocked = true;
      reportLegacyContentPropertyLoadFailed('editor', 'graph', storageUuid, 'http', { pageId: recoveryPageId, httpStatus: 404 });
    } else if (result.status === 'error') {
      legacyLoadBlocked = true;
      reportLegacyContentPropertyLoadFailed('editor', 'graph', storageUuid, result.reason, { pageId: recoveryPageId, httpStatus: result.httpStatus });
    }
    // status === 'not_found' (200 + empty results) falls through to the
    // EMPTY_GRAPH branch below as a legitimate "no legacy data, start
    // fresh" case — the page was reachable and we confirmed no key.
  }

  if (!doc) {
    doc = {
      diagramType: DiagramType.Graph,
      graphXml: EMPTY_GRAPH,
      isNew: !legacyLoadBlocked,
      legacyLoadBlocked: legacyLoadBlocked || undefined,
    } as Diagram;
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