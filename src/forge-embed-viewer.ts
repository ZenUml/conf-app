import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import globals from '@/model/globals';
import ForgeEmbedViewer from "@/components/Viewer/ForgeEmbedViewer.vue";
import EventBus from './EventBus'
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import { Diagram } from "@/model/Diagram/Diagram";
import { getDiagramData } from "@/model/Diagram/DiagramTypeConfig";
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import { bootstrapForgeViewer, type ViewerLoadDiagramResult } from '@/utils/viewerBootstrap';
import { mapCustomContentLoadError } from '@/utils/viewerLoadOutcome';
import { parseEmbedDeeplink } from '@/utils/embedDeeplink';
import { readAutoConvertLink } from '@/utils/newDiagramLink';
import { resolveEffectiveCustomContentId } from '@/utils/effectiveCustomContentId';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import type { AnalyticsProperties } from '@/utils/analytics/types';
import { attributionFromCustomContent } from '@/model/DiagramAttribution';

const AUTOCONVERT_ANALYTICS_PROPS = {
  feature_area: 'macro',
  surface: 'viewer',
  macro_type: 'embed',
  source: 'autoconvert_link',
} as const satisfies AnalyticsProperties;

export async function loadDiagram(): Promise<ViewerLoadDiagramResult> {
  const context = await initForgeContext();

  let doc: Diagram | undefined;
  let loadError = null;
  let attribution = null;
  // Covers a saved macro config, a modal opened from a non-macro surface, and a
  // pasted TYPED deeplink (`/d/<type>/<cloudId>/<contentId>`). The 3-segment
  // embed form is handled by the instrumented block below, which additionally
  // reports why a paste failed to resolve. Reading config alone here left a
  // pasted macro with no id.
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
    // loadCustomContentWithOrphanRecovery (not the bare getCustomContentByIdV2
    // this used before) — brings embed to parity with graph/sequence's orphan
    // recovery and gives loadError a real probeResult instead of undefined.
    // It classifies failures into its return shape rather than throwing (same
    // contract every other caller in this codebase relies on), so the old
    // 'fetch_failed' autoconvert-analytics reason — which fired on a THROWN
    // fetch error — no longer has a distinct trigger; those failures now
    // report as 'target_missing' like any other unresolved id.
    const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(pageId, customContentId);
    console.log('loadDiagram - customContent', loaded.customContent, 'recoveredFromOrphan?', loaded.recoveredFromOrphanId);
    doc = loaded.customContent?.value;
    attribution = attributionFromCustomContent(loaded.customContent);
    if (loaded.recoveredFromOrphanId && doc) {
      doc.recoveredFromOrphan = true;
      doc.recoveredFromOrphanId = loaded.recoveredFromOrphanId;
      reportOrphanObserved(pageId, customContentId, 'embed', loaded.probeResult, {
        recoveryUsed: true,
        recoveredId: loaded.customContent?.id != null ? String(loaded.customContent.id) : undefined,
      });
    }
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
      reportOrphanObserved(pageId, customContentId, 'embed', loaded.probeResult, { recoveryUsed: false });
      loadError = mapCustomContentLoadError(loaded);
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

  return { doc, loadError, ...(attribution ? { attribution } : {}) };
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
