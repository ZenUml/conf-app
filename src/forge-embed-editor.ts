import { trackPublishRequested } from '@/utils/analytics/publishIntent';
import globals from "@/model/globals";
import forgeGlobal, { getView, getContext as initForgeContext } from './model/globals/forgeGlobal';
import { trackEvent } from "@/utils/window";
import { trackAnalyticsEvent, trackAnalyticsEventBeforeUnload } from "@/utils/analytics/trackAnalyticsEvent";
import { markPublishClicked, trackPublishCompleted } from "@/utils/analytics/publishTiming";
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
import { isValidCustomContentId } from '@/utils/customContentId';
import { markEditorAuthoringStarted, markEditorSaved, registerEditorCloseTracking } from '@/utils/analytics/editorCloseOutcome';
import { toast } from '@/utils/toast';

type EmbedOperationMode = 'create' | 'edit';

type EmbedAuthoringSession = {
  operationMode: EmbedOperationMode;
  macroUuid?: string;
  originalConfigUuid?: string;
  suspendCloseTracking: () => void;
  resumeCloseTracking: () => void;
};

function trackEmbedSaveFailed(
  session: EmbedAuthoringSession,
  failureStage: 'validation' | 'writeback',
  failureReason: 'invalid_selected_content_id' | 'target_not_fetchable' | 'view_submit_failed',
) {
  trackAnalyticsEvent('macro_save_failed', {
    feature_area: 'macro',
    surface: 'editor',
    macro_type: 'embed',
    operation_mode: session.operationMode,
    failure_stage: failureStage,
    failure_reason: failureReason,
    ...(session.macroUuid && { macro_uuid: session.macroUuid }),
  });
}

function createSaveEmbedAndExit(session: EmbedAuthoringSession) {
  return async function saveEmbedAndExit(selectedCustomContentId: string) {
    trackPublishRequested({
      macroType: 'embed',
      operationMode: session.operationMode,
      titlePresent: !!store.state.diagram.title?.trim(),
    });
    // Start the publish-latency clock at the save-handler entry (≈ the Publish
    // click in DocumentList.vue). Stopped at the redirect below.
    markPublishClicked();
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
    const savedIdProps = {
      content_id: selectedCustomContentId,
      custom_content_id: selectedCustomContentId,
      attachment_name: `zenuml-${selectedCustomContentId}.png`,
    };

    setTimeout(async () => {
      if (!isValidCustomContentId(selectedCustomContentId)) {
        // conf-app#320 defense-in-depth: an embed macro must reference a real
        // existing customContentId. Never persist "undefined"/junk into config.
        trackEvent('save_failed', 'writeback_skipped_invalid_id', 'error', {
          selected_custom_content_id: String(selectedCustomContentId),
          macro_type: 'embed',
        });
        trackEmbedSaveFailed(session, 'validation', 'invalid_selected_content_id');
        try {
          await (await getView()).close();
        } catch {
          /* best-effort */
        }
        return;
      }
      // The picker lists docs from the SEARCH index, but the viewer loads via
      // GET-by-id. Custom content is parented to a page; when that page is
      // deleted the content is ORPHANED — it lingers in the eventually-consistent
      // search index (so it's still pickable and even previews) but GET-by-id
      // 404s because the parent no longer exists. Persisting such a pick makes a
      // silently-broken embed ("couldn't be loaded"). Block on a definitive 404
      // so the user picks a renderable doc instead. Fail-OPEN on transient errors
      // (isCustomContentFetchableV2 only returns false for a real not_found).
      if (!(await globals.apWrapper.isCustomContentFetchableV2(selectedCustomContentId))) {
        trackEvent('save_failed', 'embed_target_not_fetchable', 'error', {
          selected_custom_content_id: String(selectedCustomContentId),
          macro_type: 'embed',
        });
        trackEmbedSaveFailed(session, 'validation', 'target_not_fetchable');
        toast({
          message: "This diagram can't be embedded — it appears to have been deleted, or its page was removed. Pick a different diagram.",
          duration: 7000,
        });
        // Keep the editor open so the user can pick another; re-enable Publish
        // (DocumentList.vue listens for save-error to clear its loading state).
        EventBus.$emit('save-error', new Error('embed target not fetchable'));
        return;
      }
      // Redirect starts now (view.submit below). Stop the clock. Placed after
      // the invalid-id / not-fetchable early-returns so it only fires on a real
      // redirect, not when the editor stays open for a re-pick.
      trackPublishCompleted({
        macro_type: 'embed',
        operation_mode: session.operationMode,
        content_id: String(selectedCustomContentId),
        custom_content_id: String(selectedCustomContentId),
      });
      // A successful view.submit closes the Forge editor, so its onClose can
      // race this promise continuation. Temporarily remove only this editor's
      // cancellation subscription; a rejected submit re-arms it so a later
      // user close remains observable.
      session.suspendCloseTracking();
      try {
        await (await getView()).submit({config: {
          customContentId: selectedCustomContentId,
          updatedAt: new Date().toISOString(),
          ...(session.originalConfigUuid && { uuid: session.originalConfigUuid }),
        }});
      } catch (error) {
        session.resumeCloseTracking();
        console.error('view.submit failed after embed save', error);
        // Dialog didn't close — release the Publish button (DocumentList.vue).
        EventBus.$emit('save-error', error);
        trackEvent('save_failed', 'view_submit_failed', 'error', {
          selected_custom_content_id: selectedCustomContentId,
          macro_type: 'embed',
        });
        trackEmbedSaveFailed(session, 'writeback', 'view_submit_failed');
        return;
      }

      // Embed persists no custom content of its own: the submit above is its
      // Confluence system-of-record boundary. Hand the terminal event directly
      // to the SDK's immediate sendBeacon path while this continuation runs.
      await trackAnalyticsEventBeforeUnload(
        session.operationMode === 'create' ? 'macro_create_succeeded' : 'macro_save_succeeded',
        {
          feature_area: 'macro',
          surface: 'editor',
          macro_type: 'embed',
          operation_mode: session.operationMode,
          ...(session.macroUuid && { macro_uuid: session.macroUuid }),
          ...savedIdProps,
        },
      );
      markEditorSaved();
      if (session.operationMode === 'edit') markCsatPending();
      if (getEditJourneyId()) endEditJourney('saved');
      markRecentMacroActivity(session.operationMode);
      // Notify listeners after the macro state is durable; on submit
      // failure the catch path intentionally does NOT emit so any local
      // draft survives as a retry anchor.
      EventBus.$emit('saved', selectedCustomContentId);
    }, 500);
  };
}

async function exit() {
  await (await getView()).close();
}

async function initializeMacro() {
  const context = await initForgeContext();

  const originalConfigUuid = context.extension?.config?.uuid;
  const customContentId = context.extension?.config?.customContentId;
  // Freeze once from the context that opened this editor. A copied macro keeps
  // customContentId even when its legacy uuid is absent, so it is an edit. A
  // config value appearing or disappearing later must not split one attempt.
  const operationMode: EmbedOperationMode = customContentId ? 'edit' : 'create';
  // Match trackAnalyticsEvent's existing macro_uuid precedence: Forge localId
  // first, then the Connect-era config uuid. Freeze only an available value;
  // central enrichment retains its established unknown fallback otherwise.
  const analyticsMacroUuid =
    (forgeGlobal.isForge && context.localId)
    || originalConfigUuid
    || undefined;

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

  let stopCloseTracking: (() => void) | undefined;
  const closeTrackingConfig = {
    getMacroType: () => 'embed' as const,
    operationMode,
  };
  const authoringSession: EmbedAuthoringSession = {
    operationMode,
    macroUuid: analyticsMacroUuid,
    originalConfigUuid,
    suspendCloseTracking: () => {
      stopCloseTracking?.();
      stopCloseTracking = undefined;
    },
    resumeCloseTracking: () => {
      if (!stopCloseTracking && document.documentElement?.isConnected) {
        stopCloseTracking = registerEditorCloseTracking(closeTrackingConfig);
      }
    },
  };
  const contentProps = { saveEmbedAndExit: createSaveEmbedAndExit(authoringSession), exit, doc };
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

  markEditorAuthoringStarted();
  trackAnalyticsEvent(operationMode === 'create' ? 'macro_create_started' : 'macro_edit_started', {
    feature_area: 'macro',
    surface: 'editor',
    macro_type: 'embed',
    operation_mode: operationMode,
    entry_point: operationMode === 'create' ? 'page_editor' : 'macro_toolbar',
    ...(analyticsMacroUuid && { macro_uuid: analyticsMacroUuid }),
  });
  // The picker cannot tell whether the selection changed, so had_changes is
  // left off; the close-without-save itself is what the funnel needs.
  authoringSession.resumeCloseTracking();
}


export default initializeMacro(); 
