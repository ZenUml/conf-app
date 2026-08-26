import {Diagram, DiagramType} from "@/model/Diagram/Diagram";
import {CustomContentStorageProvider} from "@/model/ContentProvider/CustomContentStorageProvider";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import type { MacroTypeValue } from "@/utils/analytics/catalog";
import ApWrapper2 from "@/model/ApWrapper2";
import { markCsatPending } from "@/utils/csat";
import { syncCustomContent } from "@/services/CustomContent";
import globals from '@/model/globals';
import forgeGlobal from '@/model/globals/forgeGlobal';
import { reportSaveRefusedLegacyLoadBlocked } from '@/utils/legacyContentPropertyTelemetry';
import { markRecentMacroActivity } from '@/utils/paywall/warningBanner';
import { isValidCustomContentId } from '@/utils/customContentId';
import { buildSnapshot, uploadSnapshot, snapshotAttachmentName, snapshotSkipReason, snapshotFailureDetail } from '@/model/SnapshotAttachment';
import { getEditorMutationSummary } from '@/utils/analytics/editorMutationTelemetry';
import {
  ArchitectureTokenStaticIngestionError,
  prepareMermaidStaticIngestion,
  type MermaidStaticIngestionOutcome,
} from '@/services/architectureTokens/prepareMermaidStaticIngestion';
import { readMermaidArchitectureTokenBinding } from '@/services/architectureTokens/readMermaidArchitectureTokenBinding';

// ZEN-1170 Defect 1: thrown by saveToPlatform when the loaded doc carries
// the legacyLoadBlocked sentinel. Editor save handlers should catch this
// and surface a non-destructive UI affordance rather than re-throwing.
export class LegacyLoadBlockedSaveError extends Error {
  constructor(message = 'Save refused: legacy content failed to load.') {
    super(message);
    this.name = 'LegacyLoadBlockedSaveError';
  }
}

// conf-app#320: thrown by saveToPlatform when the persistence layer returned no
// usable customContentId. Editor save handlers catch it via their generic
// catch (toast + keep the editor open for retry); the autosave path swallows it.
export class InvalidSavedContentIdError extends Error {
  constructor(message = 'Save failed: persistence returned no usable customContentId.') {
    super(message);
    this.name = 'InvalidSavedContentIdError';
  }
}

export async function saveToPlatform(diagram: Diagram, apWrapper: ApWrapper2 = globals.apWrapper): Promise<string> {
  // ZEN-1170 Defect 1: refuse to save when the editor was mounted with a
  // failed legacy-content-property load. Saving would create fresh custom
  // content and (via writeback) repoint the macro XML, hiding the legacy
  // body behind a new id. The UI affordance is informational only — this
  // is the actual safety boundary.
  if (diagram.legacyLoadBlocked) {
    reportSaveRefusedLegacyLoadBlocked(String(diagram.diagramType), diagram.source);
    throw new LegacyLoadBlockedSaveError();
  }

  // Architecture Tokens v1 is Confluence-first: static source facts are put
  // into the same Diagram body that this save persists. This intentionally
  // happens before CustomContentStorageProvider.save(), so a malformed state
  // or a changed bound source cannot produce a partial custom-content write.
  let architectureStaticIngestion: MermaidStaticIngestionOutcome;
  try {
    architectureStaticIngestion = await prepareMermaidStaticIngestion(diagram);
  } catch (error) {
    if (error instanceof ArchitectureTokenStaticIngestionError) {
      trackArchitectureStaticIngestion(error.reason, 'failed');
    }
    throw error;
  }

  // Publish/save latency: start the clock at the top of the real save work so
  // save_duration_ms reflects the full user-perceived publish (custom-content
  // save round-trip + getMacroData). Read once, just before emitting the
  // success event, so the post-event syncCustomContent (D1 mirror) is excluded.
  const saveStartedAt = performance.now();

  console.log('Saving diagram to platform content provider', diagram);
  const customContentStorageProvider = new CustomContentStorageProvider(apWrapper);
  const customContent = await customContentStorageProvider.save(diagram);

  // conf-app#320 boundary invariant: never treat a save as successful without a
  // usable id. createCustomContentV2/updateCustomContentV2 now throw on an
  // id-less response, so this normally can't trip — but the success analytics
  // and the caller's macro-config writeback below both depend on a real id, so
  // fail closed here rather than emit an optimistic macro_create_succeeded and
  // return String(undefined) === "undefined" for the config.
  if (!isValidCustomContentId(customContent?.id)) {
    throw new InvalidSavedContentIdError();
  }

  await refreshMermaidArchitectureTokenBindingSession(diagram);

  const macroData = await apWrapper.getMacroData();

  // Identity for the D1 CustomContent mirror's macroUuid column. localId is
  // the Forge runtime's stable per-macro id (same value Mixpanel uses as
  // macro_uuid); legacy guestParams.uuid is the Connect-era breadcrumb,
  // kept as a fallback so long-lived macros stay stitched.
  const macroUuid =
    forgeGlobal.forgeContext?.localId
    || macroData?.uuid
    || '';

  let isNew;
  isNew = !diagram.id;

  // Analytics: embed editor handles its own tracking
  if (diagram.diagramType !== DiagramType.Embed) {
    const DIAGRAM_TYPE_TO_MACRO_TYPE: Record<string, MacroTypeValue> = {
      [DiagramType.Sequence]: 'sequence',
      [DiagramType.Mermaid]:  'mermaid',
      [DiagramType.PlantUml]: 'plantuml',
      [DiagramType.Graph]:    'graph',
      [DiagramType.OpenApi]:  'openapi',
      [DiagramType.AsyncApi]: 'asyncapi',
    };
    const macroType: MacroTypeValue = DIAGRAM_TYPE_TO_MACRO_TYPE[diagram.diagramType] ?? 'none';

    // Always identify analytics by the actually-saved customContent.id, not by
    // whatever the Forge context currently advertises: for first save the context
    // hasn't been refreshed yet, and for copies the context still points at the
    // source customContent (ApWrapper2.getCustomContentByIdV2 sets diagram.isCopy
    // but keeps diagram.id = source id, so the save creates a fresh record with
    // a different id). Without this override, central enrichment would join save
    // events to the wrong customContent.
    const savedId = String(customContent.id);
    const savedIdProps = {
      content_id: savedId,
      custom_content_id: savedId,
      attachment_name: `zenuml-${savedId}.png`,
    };

    const save_duration_ms = Math.round(performance.now() - saveStartedAt);

    if (isNew) {
      trackAnalyticsEvent("macro_create_succeeded", {
        feature_area: "macro",
        surface: "editor",
        macro_type: macroType,
        operation_mode: "create",
        save_duration_ms,
        ...savedIdProps,
      });
    } else {
      trackAnalyticsEvent("macro_save_succeeded", {
        feature_area: "macro",
        surface: "editor",
        macro_type: macroType,
        operation_mode: "edit",
        save_duration_ms,
        ...getEditorMutationSummary(),
        ...savedIdProps,
      });
    }
    trackArchitectureStaticIngestionOutcome(architectureStaticIngestion);
    markRecentMacroActivity(isNew ? 'create' : 'edit');
    markCsatPending();

    // Diagram source snapshot attachment (docs/superpowers/plans/
    // 2026-07-18-diagram-source-snapshot-attachments.md, Task 3): a per-page
    // JSON snapshot, written at THIS save (write permission on the current
    // page is guaranteed here) alongside the existing PNG backup. Snapshot
    // failures must never fail the save — every step below is wrapped.
    try {
      const snapshot = buildSnapshot(diagram, savedId, customContent.version?.number);
      if (snapshot) {
        const pageId = await apWrapper._getCurrentPageId();
        if (pageId) {
          await uploadSnapshot(pageId, snapshot);
          trackAnalyticsEvent('snapshot_created', {
            feature_area: 'macro',
            surface: 'editor',
            macro_type: macroType,
            snapshot_trigger: 'save',
            custom_content_id: savedId,
            attachment_name: snapshotAttachmentName(savedId),
          });
        }
      }
    } catch (e) {
      // #398 (remaining site): extract the Confluence exception class BEFORE
      // truncating to 200 chars — the raw v1 error envelope alone is ~180
      // chars, so a plain substring here (the original defect) cut every
      // reason off mid-sentence inside the wrapper. SnapshotAttachment.ts's
      // maybeBackfillSnapshot path already fixed this; reuse its extractor
      // rather than re-deriving the parse here.
      const { failure_reason, confluence_error_class } = snapshotFailureDetail(e);
      // On save the editor has write permission, so a 404 here is the expected
      // "page not published yet" draft case (the save-path/backfill self-heals
      // after publish) — record it as a skip, not a failure. Anything else,
      // including a 401/403 (an app-auth write anomaly the editor's own
      // permission would not explain), stays a genuine snapshot_create_failed.
      if (snapshotSkipReason(e) === 'page_not_published') {
        trackAnalyticsEvent('snapshot_backfill_skipped', {
          feature_area: 'macro',
          surface: 'editor',
          macro_type: macroType,
          snapshot_trigger: 'save',
          custom_content_id: savedId,
          snapshot_skip_reason: 'page_not_published',
          failure_reason,
          confluence_error_class,
        });
      } else {
        trackAnalyticsEvent('snapshot_create_failed', {
          feature_area: 'macro',
          surface: 'editor',
          macro_type: macroType,
          snapshot_trigger: 'save',
          custom_content_id: savedId,
          failure_reason,
          confluence_error_class,
        });
      }
    }
  }

  // NOTE: macro-metrics reporting is NOT done here. Saving submits/closes the
  // editor, tearing down the iframe and killing any in-flight enumeration
  // (which for a large space takes ~10s). It runs at editor-open instead
  // (forgeIndex), where the editing session gives it time to complete.
  await syncCustomContent(customContent, diagram.diagramType, macroUuid);

  return String(customContent.id);
}

/**
 * The stored Diagram body has now been accepted by Confluence. Re-read the
 * same in-memory metadata/source through the strict read boundary so an open
 * editor no longer presents the pre-save stale/untrusted snapshot. The before
 * source is refreshed only for an available state; every other outcome clears
 * it so a later save cannot reconcile against stale session text.
 */
async function refreshMermaidArchitectureTokenBindingSession(diagram: Diagram): Promise<void> {
  if (diagram.diagramType !== DiagramType.Mermaid) return;
  try {
    const readState = await readMermaidArchitectureTokenBinding(diagram);
    diagram.architectureTokenBindingReadState = readState;
    diagram.architectureTokenBindingLoadedSource = readState.kind === 'available'
      ? diagram.mermaidCode
      : undefined;
  } catch {
    // Confluence has already durably accepted the authoritative source and
    // binding body. A purely transient local read projection cannot turn that
    // successful save into a reported failure; expose no trusted evidence and
    // clear the before-source so later reconciliation still fails closed.
    diagram.architectureTokenBindingReadState = { kind: 'untrusted', reason: 'invalid_state' };
    diagram.architectureTokenBindingLoadedSource = undefined;
  }
}

function trackArchitectureStaticIngestionOutcome(outcome: MermaidStaticIngestionOutcome): void {
  if (outcome.kind === 'not_applicable') return;
  if (outcome.kind === 'reconciled') {
    trackAnalyticsEvent('architecture_reconciliation_completed', {
      feature_area: 'architecture_tokens',
      surface: 'editor',
      macro_type: 'mermaid',
      architecture_element_kind: 'node',
      architecture_reconciliation_status: outcome.bindingOutcome === 'accepted'
        ? 'confirmed_automatic'
        : 'needs_confirmation',
      architecture_algorithm_version: 'architecture-token-binding-v1',
      result: outcome.bindingOutcome,
    });
    return;
  }
  if (outcome.kind === 'captured' || outcome.kind === 'unchanged') {
    trackArchitectureStaticIngestion(outcome.sourceRevisionState, outcome.sourceRevisionState);
    return;
  }
  trackArchitectureStaticIngestion(outcome.kind === 'invalid' ? 'mermaid_invalid' : 'unsupported_flowchart', outcome.sourceRevisionState);
}

/**
 * This intentionally sends only closed-vocabulary operational state. Source,
 * Mermaid IDs, labels, locators, hashes, and token data stay in Confluence
 * custom content and never enter analytics.
 */
function trackArchitectureStaticIngestion(
  result: string,
  state: 'captured' | 'unchanged' | 'invalid' | 'unsupported' | 'failed',
): void {
  trackAnalyticsEvent(
    state === 'captured' || state === 'unchanged'
      ? 'architecture_source_revision_captured'
      : 'architecture_source_revision_failed',
    {
      feature_area: 'architecture_tokens',
      surface: 'editor',
      macro_type: 'mermaid',
      architecture_element_kind: 'node',
      architecture_source_revision_state: state,
      architecture_algorithm_version: 'architecture-token-binding-v1',
      result,
    },
  );
}
