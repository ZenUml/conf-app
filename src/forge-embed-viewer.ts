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

async function loadDiagram(): Promise<Diagram | undefined> {
  const context = await initForgeContext();

  // [spike] Q1: observe exactly where the autoconverted URL lands.
  console.log('[spike] extension context', JSON.stringify(context.extension));

  let doc: Diagram | undefined;
  let customContentId = context.extension?.config?.customContentId;
  const pageId = context.extension?.content?.id;

  // Autoconvert fallback: a pasted deeplink arrives with no saved config —
  // derive the target from the matched URL instead.
  if (!customContentId) {
    const link = context.extension?.config?.autoConvertLink
      ?? (context.extension as any)?.autoConvertLink; // Q1: docs are ambiguous on the path
    const deeplink = link ? parseEmbedDeeplink(link) : undefined;
    if (deeplink) {
      if (context.cloudId && deeplink.cloudId !== String(context.cloudId).toLowerCase()) {
        // Q4: foreign-site paste — fail soft, never fetch cross-tenant.
        console.warn('[spike] deeplink cloudId mismatch', deeplink.cloudId, context.cloudId);
      } else {
        customContentId = deeplink.contentId;
      }
    }
  }

  if (!customContentId) {
  } else {
    const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
    console.log('loadDiagram - customContent', customContent);
    doc = customContent?.value;
    if (!doc) {
      // ZEN-1170 telemetry: probe page children for a recovery candidate.
      void reportOrphanObserved(globals.apWrapper, context.extension?.content?.id, customContentId, 'embed');
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
