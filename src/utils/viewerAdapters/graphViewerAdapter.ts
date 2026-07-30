import globals from '@/model/globals';
import { DataSource, DiagramType, type Diagram } from '@/model/Diagram/Diagram';
import { decompress } from '@/utils/compress';
import {
  reportLegacyContentPropertyLoadFailed,
  reportLegacyContentPropertyRestored,
  reportLegacyContentPropertyValueUnexpected,
} from '@/utils/legacyContentPropertyTelemetry';
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import type { ViewerContentAdapter } from '@/utils/viewerLoadLifecycle';
import { trackEvent } from '@/utils/window';

export interface GraphViewerContext {
  cloudId?: string | number;
  localId?: string;
  extension?: {
    config?: { customContentId?: string | number; uuid?: string | number };
    content?: { id?: string | number };
  };
}

export interface GraphViewerTarget {
  customContentId?: string;
  storageUuid?: string;
  pageId?: string;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

export const graphViewerAdapter: ViewerContentAdapter<GraphViewerContext, GraphViewerTarget> = {
  async resolve(context) {
    const customContentId = optionalString(context.extension?.config?.customContentId);
    // Legacy graph bodies were written under config.uuid. Forge localId is a
    // different identifier and must never be substituted here (ZEN-1170).
    const storageUuid = optionalString(context.extension?.config?.uuid);
    const pageId = optionalString(context.extension?.content?.id);
    if (!customContentId && !storageUuid) {
      return { status: 'empty', reason: 'missing_target' };
    }
    return {
      status: 'loadable',
      target: { customContentId, storageUuid, pageId },
      cacheIdentity: context.cloudId && customContentId
        ? {
            cloudId: String(context.cloudId),
            customContentId,
            macroKind: 'graph',
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
      console.log(
        'loadDiagram - customContent',
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
          'graph',
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
          'graph',
          loaded.probeResult,
          { recoveryUsed: false },
        );
      }
    }

    if (!doc && target.storageUuid) {
      const result = await globals.apWrapper.getContentPropertyV2(
        `zenuml-graph-macro-${target.storageUuid}-body`,
      );
      if (result.status === 'ok') {
        const value = result.property.value;
        if (value && typeof value === 'object') {
          const restored = value as Diagram & { compressed?: boolean };
          let graphXml = restored.graphXml;
          if (restored.compressed && graphXml && !graphXml.startsWith('<mxGraphModel')) {
            graphXml = decompress(graphXml);
          }
          doc = {
            ...restored,
            graphXml,
            compressed: false,
            diagramType: DiagramType.Graph,
            source: DataSource.ContentProperty,
            id: undefined,
            recoveredFromOrphan: true,
          };
          reportLegacyContentPropertyRestored(
            'viewer',
            'graph',
            target.storageUuid,
            { pageId: target.pageId },
          );
        } else if (typeof value === 'string') {
          reportLegacyContentPropertyValueUnexpected(
            'viewer',
            'graph',
            target.storageUuid,
            'string',
          );
        } else {
          reportLegacyContentPropertyValueUnexpected(
            'viewer',
            'graph',
            target.storageUuid,
            value == null ? 'null' : 'other',
          );
        }
      } else if (result.status !== 'not_found') {
        reportLegacyContentPropertyLoadFailed(
          'viewer',
          'graph',
          target.storageUuid,
          result.status === 'forbidden'
            ? 'forbidden'
            : result.status === 'error'
              ? result.reason
              : 'thrown',
          { pageId: target.pageId },
        );
      }

      if (!doc) {
        const recovered = await globals.apWrapper.findLegacyCustomContentByUuid(target.storageUuid);
        if (recovered?.value) {
          doc = recovered.value;
          doc.recoveredFromOrphan = true;
          trackEvent(target.storageUuid, 'legacy_custom_content_by_uuid_restored', 'info', {
            surface: 'viewer',
            macro_type: 'graph',
            recovered_id: String(recovered.id ?? ''),
            is_copy: doc.isCopy ? 'true' : 'false',
            ...(target.pageId && { page_id: target.pageId }),
          });
        }
      }
    }

    return doc;
  },
};
