import globals from '@/model/globals';
import type { Diagram } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import type { AnalyticsProperties } from '@/utils/analytics/types';
import { parseEmbedDeeplink } from '@/utils/embedDeeplink';
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import type {
  ViewerContentAdapter,
  ViewerTargetResolution,
} from '@/utils/viewerLoadLifecycle';
import { trackEvent } from '@/utils/window';

const AUTOCONVERT_ANALYTICS_PROPS = {
  feature_area: 'macro',
  surface: 'viewer',
  macro_type: 'embed',
  source: 'autoconvert_link',
} as const satisfies AnalyticsProperties;

export interface EmbedViewerContext {
  cloudId?: string | number;
  extension?: {
    config?: { customContentId?: string | number; uuid?: string | number };
    content?: { id?: string | number };
    autoConvertLink?: string;
  };
}

export interface EmbedViewerTarget {
  customContentId?: string;
  storageUuid?: string;
  pageId?: string;
  autoconvertProps?: AnalyticsProperties;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

function legacyOrEmpty(
  target: Omit<EmbedViewerTarget, 'customContentId' | 'autoconvertProps'>,
  reason: 'missing_target' | 'invalid_target' | 'cross_tenant',
): ViewerTargetResolution<EmbedViewerTarget> {
  if (!target.storageUuid) return { status: 'empty', reason };
  return {
    status: 'loadable',
    target: { ...target, customContentId: undefined, autoconvertProps: undefined },
    cacheIdentity: undefined,
  };
}

export const embedViewerAdapter: ViewerContentAdapter<EmbedViewerContext, EmbedViewerTarget> = {
  async resolve(context) {
    const pageId = optionalString(context.extension?.content?.id);
    const storageUuid = optionalString(context.extension?.config?.uuid);
    const directId = optionalString(context.extension?.config?.customContentId);
    const legacyTarget = { storageUuid, pageId };

    if (directId) {
      return {
        status: 'loadable',
        target: { customContentId: directId, storageUuid, pageId },
        cacheIdentity: context.cloudId
          ? {
              cloudId: String(context.cloudId),
              customContentId: directId,
              macroKind: 'embed',
            }
          : undefined,
      };
    }

    const autoConvertLink = context.extension?.autoConvertLink;
    if (!autoConvertLink) return legacyOrEmpty(legacyTarget, 'missing_target');

    const deeplink = parseEmbedDeeplink(autoConvertLink);
    if (!deeplink) {
      trackAnalyticsEvent('embed_autoconvert_detected', AUTOCONVERT_ANALYTICS_PROPS);
      trackAnalyticsEvent('embed_autoconvert_failed', {
        ...AUTOCONVERT_ANALYTICS_PROPS,
        failure_reason: 'invalid_url',
      });
      return legacyOrEmpty(legacyTarget, 'invalid_target');
    }

    const isSameSite = context.cloudId
      ? deeplink.cloudId === String(context.cloudId).toLowerCase()
      : undefined;
    const autoconvertProps: AnalyticsProperties = {
      ...AUTOCONVERT_ANALYTICS_PROPS,
      custom_content_id: deeplink.contentId,
      ...(isSameSite !== undefined ? { is_same_site: isSameSite } : {}),
    };
    trackAnalyticsEvent('embed_autoconvert_detected', autoconvertProps);

    if (isSameSite === false) {
      trackAnalyticsEvent('embed_autoconvert_cross_tenant_rejected', autoconvertProps);
      return legacyOrEmpty(legacyTarget, 'cross_tenant');
    }

    return {
      status: 'loadable',
      target: {
        customContentId: deeplink.contentId,
        storageUuid,
        pageId,
        autoconvertProps,
      },
      cacheIdentity: context.cloudId
        ? {
            cloudId: String(context.cloudId),
            customContentId: deeplink.contentId,
            macroKind: 'embed',
          }
        : undefined,
    };
  },

  async load(target): Promise<Diagram | undefined> {
    let doc: Diagram | undefined;
    if (target.customContentId) {
      const customContent = await globals.apWrapper
        .getCustomContentByIdV2(target.customContentId)
        .catch((error) => {
          if (target.autoconvertProps) {
            trackAnalyticsEvent('embed_autoconvert_failed', {
              ...target.autoconvertProps,
              failure_reason: 'fetch_failed',
            });
          }
          throw error;
        });
      console.log('loadDiagram - customContent', customContent);
      doc = customContent?.value;
      if (doc && target.autoconvertProps) {
        // Resolution proves that the target document loaded. The lifecycle's
        // macro_viewed terminal remains the visual-render success signal.
        trackAnalyticsEvent('embed_autoconvert_target_resolved', target.autoconvertProps);
      }
      if (!doc) {
        if (target.autoconvertProps) {
          trackAnalyticsEvent('embed_autoconvert_failed', {
            ...target.autoconvertProps,
            failure_reason: 'target_missing',
          });
        }
        reportOrphanObserved(
          target.pageId,
          target.customContentId,
          'embed',
          undefined,
          { recoveryUsed: false },
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
          macro_type: 'embed',
          recovered_id: String(recovered.id ?? ''),
          is_copy: doc.isCopy ? 'true' : 'false',
          ...(target.pageId && { page_id: target.pageId }),
        });
      }
    }

    return doc;
  },
};
