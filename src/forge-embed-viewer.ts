import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import globals from '@/model/globals';
import ForgeEmbedViewer from "@/components/Viewer/ForgeEmbedViewer.vue";
import EventBus from './EventBus'
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import { Diagram } from "@/model/Diagram/Diagram";
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import { bootstrapForgeViewer } from '@/utils/viewerBootstrap';

async function loadDiagram(): Promise<Diagram | undefined> {
  const context = await initForgeContext();

  let doc: Diagram | undefined;
  const customContentId = context.extension?.config?.customContentId;
  const pageId = context.extension?.content?.id;
  if(!customContentId) {
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
        await createAttachmentIfContentChanged(doc?.code || doc?.graphXml || doc?.mermaidCode || '', doc?.diagramType ?? 'embed');
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
