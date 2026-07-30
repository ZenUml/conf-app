import globals from '@/model/globals';
import { DataSource, DiagramType, type Diagram } from '@/model/Diagram/Diagram';
import Example from '@/utils/sequence/Example';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import {
  reportLegacyContentPropertyLoadFailed,
  reportLegacyContentPropertyRestored,
  reportLegacyContentPropertyValueUnexpected,
} from '@/utils/legacyContentPropertyTelemetry';
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import type { ViewerContentAdapter } from '@/utils/viewerLoadLifecycle';
import { trackEvent } from '@/utils/window';

export interface DiagramViewerContext {
  cloudId?: string | number;
  localId?: string;
  extension?: {
    config?: { customContentId?: string | number; uuid?: string | number };
    modal?: {
      customContentId?: string | number;
      macroMode?: string;
      diagramType?: string;
    };
    content?: { id?: string | number };
  };
}

export interface DiagramViewerTarget {
  customContentId?: string;
  storageUuid?: string;
  pageId?: string;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

const VALID_DIAGRAM_TYPES: ReadonlyArray<DiagramType> = [
  DiagramType.Sequence,
  DiagramType.Mermaid,
  DiagramType.PlantUml,
];

/** Mirror the Connect content-property provider's legacy type inference. */
export function normalizeLegacyDiagram(value: Record<string, unknown>): Diagram {
  const restored = value as unknown as Diagram;
  const storedTypeIsValid = Boolean(
    restored.diagramType && VALID_DIAGRAM_TYPES.includes(restored.diagramType),
  );
  const diagramType = storedTypeIsValid
    ? restored.diagramType
    : restored.code
      ? DiagramType.Sequence
      : restored.mermaidCode
        ? DiagramType.Mermaid
        : restored.plantUmlCode
          ? DiagramType.PlantUml
          : DiagramType.Sequence;
  return {
    ...restored,
    diagramType,
    source: DataSource.ContentProperty,
    id: undefined,
    recoveredFromOrphan: true,
  };
}

function withPlantUmlDefault(doc: Diagram): Diagram {
  return doc.plantUmlCode ? doc : { ...doc, plantUmlCode: Example.PlantUml };
}

export const diagramViewerAdapter: ViewerContentAdapter<
  DiagramViewerContext,
  DiagramViewerTarget
> = {
  normalize: withPlantUmlDefault,

  async resolve(context) {
    const customContentId = optionalString(
      context.extension?.config?.customContentId
      || context.extension?.modal?.customContentId,
    );
    // Connect-era content properties use config.uuid. Forge localId is a
    // different identifier and must never be substituted here (ZEN-1170).
    const storageUuid = optionalString(context.extension?.config?.uuid);
    const pageId = optionalString(context.extension?.content?.id);

    if (!customContentId && !storageUuid) {
      return { status: 'empty', reason: 'missing_target' };
    }

    const fullscreen = context.extension?.modal?.macroMode === 'fullscreen';
    return {
      status: 'loadable',
      target: { customContentId, storageUuid, pageId },
      // Sequence/Mermaid/PlantUML share one Forge macro entry and the concrete
      // diagram type is only known after content publication. The family key
      // is therefore stable at target-resolution time; terminal analytics use
      // the published document's concrete type.
      cacheIdentity: !fullscreen && context.cloudId && customContentId
        ? {
            cloudId: String(context.cloudId),
            customContentId,
            macroKind: 'sequence',
          }
        : undefined,
    };
  },

  async load(target): Promise<Diagram | undefined> {
    let doc: Diagram | undefined;

    if (target.customContentId) {
      const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(
        target.pageId,
        target.customContentId,
        { copyCheckMode: 'cross-page-only' },
      );
      console.debug(
        'Loaded custom content',
        loaded.customContent,
        'recoveredFromOrphan?',
        loaded.recoveredFromOrphanId,
      );
      doc = loaded.customContent?.value;

      if (loaded.recoveredFromOrphanId && doc) {
        doc.recoveredFromOrphan = true;
        doc.recoveredFromOrphanId = loaded.recoveredFromOrphanId;
        reportOrphanObserved(
          target.pageId,
          target.customContentId,
          'sequence',
          loaded.probeResult,
          {
            recoveryUsed: true,
            recoveredId: loaded.customContent?.id != null
              ? String(loaded.customContent.id)
              : undefined,
          },
        );
      } else if (!doc) {
        reportOrphanObserved(
          target.pageId,
          target.customContentId,
          'sequence',
          loaded.probeResult,
          { recoveryUsed: false },
        );
      }

      if (doc && loaded.customContent && target.pageId) {
        import('@/model/SnapshotAttachment').then(({ maybeBackfillSnapshot }) =>
          maybeBackfillSnapshot({
            hostPageId: target.pageId!,
            ccId: target.customContentId!,
            ccPageId: loaded.customContent!.pageId,
            diagram: doc!,
            ccVersion: loaded.customContent!.version?.number,
            isDisplayMode: globals.apWrapper.isDisplayMode(),
          }),
        ).catch((error) => console.debug('[snapshot] backfill skipped', error));
      }
    }

    if (!doc && target.storageUuid) {
      const result = await globals.apWrapper.getContentPropertyV2(
        `zenuml-sequence-macro-${target.storageUuid}-body`,
      );
      if (result.status === 'ok') {
        const value = result.property.value;
        if (value && typeof value === 'object') {
          doc = normalizeLegacyDiagram(value as unknown as Record<string, unknown>);
          reportLegacyContentPropertyRestored(
            'viewer',
            'sequence',
            target.storageUuid,
            { pageId: target.pageId },
          );
        } else if (typeof value === 'string') {
          doc = {
            diagramType: DiagramType.Sequence,
            source: DataSource.ContentPropertyOld,
            code: value,
            id: undefined,
            recoveredFromOrphan: true,
          } as Diagram;
          reportLegacyContentPropertyRestored(
            'viewer',
            'sequence',
            target.storageUuid,
            { pageId: target.pageId, valueType: 'string_legacy' },
          );
        } else {
          reportLegacyContentPropertyValueUnexpected(
            'viewer',
            'sequence',
            target.storageUuid,
            value == null ? 'null' : 'other',
          );
        }
      } else if (result.status === 'forbidden') {
        reportLegacyContentPropertyLoadFailed(
          'viewer', 'sequence', target.storageUuid, 'forbidden', { pageId: target.pageId },
        );
      } else if (result.status === 'page_not_found') {
        reportLegacyContentPropertyLoadFailed(
          'viewer', 'sequence', target.storageUuid, 'http',
          { pageId: target.pageId, httpStatus: 404 },
        );
      } else if (result.status === 'error') {
        reportLegacyContentPropertyLoadFailed(
          'viewer', 'sequence', target.storageUuid, result.reason,
          { pageId: target.pageId, httpStatus: result.httpStatus },
        );
      }
    }

    if (!doc && target.storageUuid) {
      const recovered = await globals.apWrapper.findLegacyCustomContentByUuid(target.storageUuid);
      if (recovered?.value) {
        doc = recovered.value;
        doc.recoveredFromOrphan = true;
        trackEvent(target.storageUuid, 'legacy_custom_content_by_uuid_restored', 'info', {
          surface: 'viewer',
          macro_type: 'sequence',
          recovered_id: String(recovered.id ?? ''),
          is_copy: doc.isCopy ? 'true' : 'false',
          ...(target.pageId && { page_id: target.pageId }),
        });
      }
    }

    if (!doc && target.customContentId && target.pageId) {
      const { fetchSnapshot, snapshotToDiagram } = await import('@/model/SnapshotAttachment');
      const snapshot = await fetchSnapshot(target.pageId, target.customContentId);
      if (snapshot) {
        const restored = snapshotToDiagram(snapshot);
        if (restored.diagramType !== DiagramType.Unknown) {
          doc = restored;
          const ageDays = Math.floor(
            (Date.now() - new Date(snapshot.snapshotAt).getTime()) / 86_400_000,
          );
          trackAnalyticsEvent('snapshot_fallback_rendered', {
            feature_area: 'macro',
            surface: 'viewer',
            custom_content_id: target.customContentId,
            snapshot_age_days: ageDays,
          });
        }
      }
    }

    return doc;
  },
};
