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
import { buildSnapshot, uploadSnapshot, snapshotAttachmentName } from '@/model/SnapshotAttachment';

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

    if (isNew) {
      trackAnalyticsEvent("macro_create_succeeded", {
        feature_area: "macro",
        surface: "editor",
        macro_type: macroType,
        operation_mode: "create",
        ...savedIdProps,
      });
    } else {
      trackAnalyticsEvent("macro_save_succeeded", {
        feature_area: "macro",
        surface: "editor",
        macro_type: macroType,
        operation_mode: "edit",
        ...savedIdProps,
      });
    }
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
      trackAnalyticsEvent('snapshot_create_failed', {
        feature_area: 'macro',
        surface: 'editor',
        macro_type: macroType,
        snapshot_trigger: 'save',
        custom_content_id: savedId,
        error_message: String(e instanceof Error ? e.message : e).substring(0, 200),
      });
    }
  }

  // NOTE: macro-metrics reporting is NOT done here. Saving submits/closes the
  // editor, tearing down the iframe and killing any in-flight enumeration
  // (which for a large space takes ~10s). It runs at editor-open instead
  // (forgeIndex), where the editing session gives it time to complete.
  await syncCustomContent(customContent, diagram.diagramType, macroUuid);

  return String(customContent.id);
}
