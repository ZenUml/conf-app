import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import globals from '@/model/globals';
import ForgeEmbedViewer from "@/components/Viewer/ForgeEmbedViewer.vue";
import EventBus from './EventBus'
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import { Diagram, getDiagramData } from "@/model/Diagram/Diagram";
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import { bootstrapForgeViewer } from '@/utils/viewerBootstrap';
import { parseEmbedDeeplink } from '@/utils/embedDeeplink';
import { readAutoConvertLink } from '@/utils/newDiagramLink';
import { resolveEffectiveCustomContentId } from '@/utils/effectiveCustomContentId';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import type { AnalyticsProperties } from '@/utils/analytics/types';

const AUTOCONVERT_ANALYTICS_PROPS = {
  feature_area: 'macro',
  surface: 'viewer',
  macro_type: 'embed',
  source: 'autoconvert_link',
} as const satisfies AnalyticsProperties;

export async function loadDiagram(): Promise<Diagram | undefined> {
  const context = await initForgeContext();

  let doc: Diagram | undefined;
  // Covers a saved macro config, a modal opened from a non-macro surface, and a
  // pasted TYPED deeplink (`/d/<type>/<cloudId>/<contentId>`). The 3-segment
  // embed form is handled by the instrumented block below, which additionally
  // reports why a paste failed to resolve.
  let customContentId = resolveEffectiveCustomContentId(context);
  let autoconvertProps: AnalyticsProperties | undefined;
  const pageId = context.extension?.content?.id;

  // AutoConvert: a pasted https://<host>/d/<cloudId>/<contentId> deeplink lands
  // with no saved macro config — resolve the target from the matched URL
  // instead. `autoConvertLink` is a top-level extension-context field per
  // Atlassian's docs, not nested under `config`:
  // https://developer.atlassian.com/platform/forge/manifest-reference/modules/macro/
  // readAutoConvertLink also accepts the `config` and `parameters` shapes,
  // because the value observed in a live page's ADF sits under `parameters`.
  const autoConvertLink = readAutoConvertLink(context);
  if (!customContentId && autoConvertLink) {
    const deeplink = parseEmbedDeeplink(autoConvertLink);
    if (!deeplink) {
      trackAnalyticsEvent('embed_autoconvert_detected', AUTOCONVERT_ANALYTICS_PROPS);
      trackAnalyticsEvent('embed_autoconvert_failed', {
        ...AUTOCONVERT_ANALYTICS_PROPS,
        failure_reason: 'invalid_url',
      });
    } else {
      const isSameSite = context.cloudId
        ? deeplink.cloudId === String(context.cloudId).toLowerCase()
        : undefined;
      autoconvertProps = {
        ...AUTOCONVERT_ANALYTICS_PROPS,
        custom_content_id: deeplink.contentId,
        ...(isSameSite !== undefined && { is_same_site: isSameSite }),
      };
      trackAnalyticsEvent('embed_autoconvert_detected', autoconvertProps);

      if (isSameSite === false) {
        // Fail soft on a foreign-site paste — never fetch cross-tenant.
        trackAnalyticsEvent('embed_autoconvert_cross_tenant_rejected', autoconvertProps);
      } else {
        customContentId = deeplink.contentId;
      }
    }
  }

  if (customContentId) {
    const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId)
      .catch((error) => {
        if (autoconvertProps) {
          trackAnalyticsEvent('embed_autoconvert_failed', {
            ...autoconvertProps,
            failure_reason: 'fetch_failed',
          });
        }
        throw error;
      });
    console.log('loadDiagram - customContent', customContent);
    doc = customContent?.value;
    if (doc && autoconvertProps) {
      // Resolution proves the referenced document loaded, not that pixels
      // painted. `macro_viewed` remains the rendered-view signal.
      trackAnalyticsEvent('embed_autoconvert_target_resolved', autoconvertProps);
    }
    if (!doc) {
      if (autoconvertProps) {
        trackAnalyticsEvent('embed_autoconvert_failed', {
          ...autoconvertProps,
          failure_reason: 'target_missing',
        });
      }
      // ZEN-1170 telemetry. #147: the original call passed the arguments in the
      // WRONG order — (apWrapper, pageId, customContentId, 'embed') against the
      // real signature (pageId, orphanId, diagramKind, probeResult, options) —
      // so every embed orphan event was mislabeled (diagram_kind became the
      // customContentId and page_id became an ApWrapper object). The embed
      // viewer fetches the doc directly via getCustomContentByIdV2 (no orphan
      // probe), so there is no probeResult to pass — undefined makes
      // reportOrphanObserved emit the reduced "probe_skipped_no_probe_result"
      // shape with the correct diagram_kind='embed'.
      reportOrphanObserved(pageId, customContentId, 'embed', undefined, { recoveryUsed: false });
    }
  }

  // ZEN-1170 Defect 1 sibling: cross-page-paste recovery via uuid → CC title.
  // Embed macros never used content properties (no Defect 1 path here), but
  // the Connect-era {uuid, updatedAt}-only param shape is possible for them
  // too, and copy-pasting such a macro leaves the destination with no
  // customContentId. Find the surviving CC by exact-title CQL search.
  if (!doc) {
    const storageUuid = context.extension?.config?.uuid;
    if (storageUuid) {
      const recovered = await globals.apWrapper.findLegacyCustomContentByUuid(storageUuid);
      if (recovered?.value) {
        doc = recovered.value;
        doc.recoveredFromOrphan = true;
        trackEvent(storageUuid, 'legacy_custom_content_by_uuid_restored', 'info', {
          surface: 'viewer',
          macro_type: 'embed',
          recovered_id: String(recovered.id ?? ''),
          is_copy: doc.isCopy ? 'true' : 'false',
          ...(pageId && { page_id: pageId }),
        });
      }
    }
  }

  return doc;
}

function afterLoad(doc: Diagram | undefined) {
  setTimeout(async function () {
    try {
      if(globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()) {
        // Select the body by the doc's OWN diagramType. The old
        // `code || graphXml || mermaidCode` chain never looked at
        // plantUmlCode, so a plantuml doc converted from the default
        // sequence template shipped its leftover ZenUML `code` labeled
        // 'plantuml' — feeding capturePng a doomed PlantUML-server fetch
        // (400) and hashing/iTXt-embedding the wrong source.
        const content = doc?.diagramType
          ? getDiagramData(doc)
          : (doc?.code || doc?.graphXml || doc?.mermaidCode || '');
        await createAttachmentIfContentChanged(content, doc?.diagramType ?? 'embed');
      } else {
        console.debug("Attachment will no be created as it's not in view mode or the user is unauthorized to edit.");
      }
    } catch (e) {
      // Do not re-throw the error
      console.error("Error when creating attachment", e);
      trackEvent(serializeError(e), 'create_attachment', 'error');
    }

  }, 1500);
}



/**
 * Same id resolution `loadDiagram` performs above, before its fetch: the
 * saved config id, or — for an autoConvert paste that hasn't saved a config
 * yet — the deeplink target parsed from `autoConvertLink`. `parseEmbedDeeplink`
 * is a pure regex match (no network call), so this is resolvable synchronously
 * from context exactly like the graph/openapi resolvers. Cross-tenant pastes
 * resolve to undefined, same as `loadDiagram` — never cache/read a foreign-site
 * paste. The legacy-uuid recovery fallback inside `loadDiagram` (for a macro
 * with neither a saved config id nor a matching deeplink) has no id to resolve
 * here either — it's excluded from the cache exactly like graph/openapi's own
 * legacy-uuid fallback.
 */
function resolveEmbedContentId(context: any): string | undefined {
  const direct = context.extension?.config?.customContentId;
  if (direct) return direct;
  const deeplink = context.extension?.autoConvertLink
    ? parseEmbedDeeplink(context.extension.autoConvertLink)
    : undefined;
  if (!deeplink) return undefined;
  if (context.cloudId && deeplink.cloudId !== String(context.cloudId).toLowerCase()) {
    return undefined;
  }
  return deeplink.contentId;
}

async function initializeMacro() {
  await bootstrapForgeViewer({
    macroKind: 'embed',
    content: ForgeEmbedViewer,
    loadDiagram,
    afterLoad,
    resolveContentId: resolveEmbedContentId,
    onError: (error) => {
      console.error('Error loading embed viewer', error);
    },
  });
}

export default initializeMacro();

EventBus.$on('edit', async () => {
  await openModal({
    resource: 'main',
    onClose: (payload: any) => {
      console.log('onClose called with', payload);
      location.reload();
    },
    size: 'fullscreen',
    context: {
      macroMode: 'editor',
    },
  });
});
