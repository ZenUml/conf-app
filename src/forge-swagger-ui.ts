import "swagger-ui/dist/swagger-ui.css";
import './assets/tailwind.css'

import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import globals from '@/model/globals';
import OpenApiViewer from "@/components/Viewer/OpenApiViewer.vue";
import EventBus from './EventBus'
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import { type Diagram, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import { guardEditClick } from '@/utils/guardEditClick';
import { mountRoot } from '@/mount-root';
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import { runViewerLoadLifecycle } from '@/utils/viewerLoadLifecycle';
import { openApiViewerAdapter } from '@/utils/viewerAdapters/openApiViewerAdapter';

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
  await runViewerLoadLifecycle({
    macroType: 'openapi',
    initializeContext: () => globals.apWrapper.initializeContext(),
    getContext: initForgeContext,
    adapter: openApiViewerAdapter,
    loadingDocument: NULL_DIAGRAM,
    mountLoadingBeforeCache: true,
    mount: async (doc, reporter) => {
      const paywalled = await tryFullscreenViewerPaywall({
        doc,
        content: OpenApiViewer,
        macroKind: 'openapi',
        viewerRenderReporter: reporter,
      });
      if (!paywalled) {
        mountRoot(doc, OpenApiViewer, {}, { viewerRenderReporter: reporter });
      }
    },
    afterFreshLoad: afterLoad,
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
  // Same-page duplicate gate — see forge-graph-viewer.ts. Memoized, so the
  // shared forgeIndex listener firing on this same click costs no extra GET.
  if (!(await guardEditClick({ customContentId, macroType: 'openapi' }))) return;

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
