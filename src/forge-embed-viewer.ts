import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import globals from '@/model/globals';
import ForgeEmbedViewer from "@/components/Viewer/ForgeEmbedViewer.vue";
import EventBus from './EventBus'
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import { Diagram, getDiagramData } from "@/model/Diagram/Diagram";
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import { bootstrapForgeViewer } from '@/utils/viewerBootstrap';
import {
  resolveEmbedAutoconvertTarget,
  trackEmbedAutoconvertTargetResult,
} from '@/utils/embedAutoconvertTelemetry';

async function loadDiagram(): Promise<Diagram | undefined> {
  const context = await initForgeContext();

  let doc: Diagram | undefined;
  let customContentId = context.extension?.config?.customContentId;
  let resolvedFromAutoConvert = false;
  const pageId = context.extension?.content?.id;

  // AutoConvert: a pasted https://confluence.zenuml.com/d/<cloudId>/<contentId>
  // deeplink lands with no saved macro config — resolve the target from the
  // matched URL instead. `autoConvertLink` is a top-level extension-context
  // field per Atlassian's docs, not nested under `config`:
  // https://developer.atlassian.com/platform/forge/manifest-reference/modules/macro/
  if (!customContentId && context.extension?.autoConvertLink) {
    const target = resolveEmbedAutoconvertTarget(
      context.extension.autoConvertLink,
      context.cloudId ? String(context.cloudId) : undefined,
    );
    if (target) {
      customContentId = target.contentId;
      resolvedFromAutoConvert = true;
    }
  }

  if(!customContentId) {
  } else {
    const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
    console.log('loadDiagram - customContent', customContent);
    doc = customContent?.value;
    if (resolvedFromAutoConvert) {
      trackEmbedAutoconvertTargetResult(Boolean(doc));
    }
    if (!doc) {
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



async function initializeMacro() {
  await bootstrapForgeViewer({
    macroKind: 'embed',
    content: ForgeEmbedViewer,
    loadDiagram,
    afterLoad,
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
