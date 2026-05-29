import "swagger-ui/dist/swagger-ui.css";
import './assets/tailwind.css'

import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import globals from '@/model/globals';
import OpenApiViewer from "@/components/Viewer/OpenApiViewer.vue";
import EventBus from './EventBus'
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import { Diagram } from "@/model/Diagram/Diagram";
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import { bootstrapForgeViewer } from '@/utils/viewerBootstrap';

async function loadDiagram(): Promise<Diagram | undefined> {
  const context = await initForgeContext();

  let doc: Diagram | undefined;
  const customContentId = context.extension?.config?.customContentId;
  if(!customContentId) {
  } else {
    const pageId = context.extension?.content?.id;
    const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(pageId, customContentId);
    console.log('loadDiagram - customContent', loaded.customContent, 'recoveredFromOrphan?', loaded.recoveredFromOrphanId);
    doc = loaded.customContent?.value;
    if (loaded.recoveredFromOrphanId && doc) {
      doc.recoveredFromOrphan = true;
      doc.recoveredFromOrphanId = loaded.recoveredFromOrphanId;
      reportOrphanObserved(pageId, customContentId, 'openapi', loaded.probeResult, {
        recoveryUsed: true,
        recoveredId: loaded.customContent?.id != null ? String(loaded.customContent.id) : undefined,
      });
    } else if (!doc) {
      reportOrphanObserved(pageId, customContentId, 'openapi', loaded.probeResult, { recoveryUsed: false });
    }
  }
  return doc;
}

function afterLoad(doc: Diagram | undefined) {
  setTimeout(async function () {
    try {
      if(globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()) {
        await createAttachmentIfContentChanged(doc?.code ?? '', 'openapi');
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
    macroKind: 'openapi',
    content: OpenApiViewer,
    loadDiagram,
    afterLoad,
    onError: (error) => {
      console.error('Error loading OpenAPI viewer', error);
    },
  });
}

export default initializeMacro();

EventBus.$on('edit', async () => {
  const ctx = await initForgeContext();
  // Forward the macro's customContentId so the editor modal can load the
  // right diagram via context.extension.modal.customContentId (matches the
  // sequence-editor pattern in forgeIndex.ts). Without this, viewer-launched
  // edits arrive at forge-swagger-editor.ts with no customContentId and are
  // mistakenly treated as new-macro sessions.
  const customContentId = ctx.extension?.config?.customContentId;
  await openModal({
    resource: 'main',
    onClose: (payload: any) => {
      console.log('onClose called with', payload);
      location.reload();
    },
    size: 'fullscreen',
    context: {
      macroMode: 'editor',
      ...(customContentId && { customContentId }),
    },
  });
});
