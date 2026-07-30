import globals from '@/model/globals';
import type { Diagram } from '@/model/Diagram/Diagram';
import { trackEvent } from '@/utils/window';
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import type { ViewerContentAdapter } from '@/utils/viewerLoadLifecycle';

export interface OpenApiViewerContext {
  cloudId?: string | number;
  extension?: {
    config?: { customContentId?: string | number; uuid?: string | number };
    modal?: { customContentId?: string | number };
    content?: { id?: string | number };
  };
}

export interface OpenApiViewerTarget {
  customContentId?: string;
  storageUuid?: string;
  pageId?: string;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

export const openApiViewerAdapter: ViewerContentAdapter<
  OpenApiViewerContext,
  OpenApiViewerTarget
> = {
  async resolve(context) {
    const customContentId = optionalString(
      context.extension?.config?.customContentId
      || context.extension?.modal?.customContentId,
    );
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
            macroKind: 'openapi',
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
          'openapi',
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
          'openapi',
          loaded.probeResult,
          { recoveryUsed: false },
        );
      }
    }

    // Connect-era uuid-only macros can recover the surviving custom content by
    // exact title. This remains loadable without creating an unscoped cache id.
    if (!doc && target.storageUuid) {
      const recovered = await globals.apWrapper.findLegacyCustomContentByUuid(target.storageUuid);
      if (recovered?.value) {
        doc = recovered.value;
        doc.recoveredFromOrphan = true;
        trackEvent(target.storageUuid, 'legacy_custom_content_by_uuid_restored', 'info', {
          surface: 'viewer',
          macro_type: 'openapi',
          recovered_id: String(recovered.id ?? ''),
          is_copy: doc.isCopy ? 'true' : 'false',
          ...(target.pageId && { page_id: target.pageId }),
        });
      }
    }

    return doc;
  },
};
