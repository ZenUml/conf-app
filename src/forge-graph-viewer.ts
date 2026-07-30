import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import globals from '@/model/globals';
import {decompress} from '@/utils/compress';
import ForgeGraphViewer from "@/components/Viewer/ForgeGraphViewer.vue";
import EventBus from './EventBus'
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import { type Diagram, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import { ensureDrawioViewerLoaded } from '@/utils/drawio/loadDrawioViewer';
import { guardEditClick } from '@/utils/guardEditClick';
import { mountRoot } from '@/mount-root';
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import { runViewerLoadLifecycle } from '@/utils/viewerLoadLifecycle';
import { graphViewerAdapter } from '@/utils/viewerAdapters/graphViewerAdapter';

function afterLoad(doc: Diagram | undefined) {
  // Rendering is driven by the store (viewerLoadLifecycle normalizes legacy
  // compressed graph bodies to plain XML before the store write). Here we only
  // need plain XML for the attachment side-effect below, plus the compressed_*
  // telemetry that sizes how many legacy compressed graph macros are loaded.
  let graphXml = doc?.graphXml;
  if (doc?.compressed) {
    trackEvent('compressed_field_viewer', 'load', 'warning');
    if (!graphXml?.startsWith('<mxGraphModel')) {
      graphXml = decompress(doc.graphXml);
      trackEvent('compressed_content_viewer', 'load', 'warning');
    }
  }

  setTimeout(async function () {
    try {
      // ZEN-1170 Defect 1: the missing-customContentId case is handled
      // centrally inside createAttachmentIfContentChanged (Attachment.ts)
      // — it emits the `missing_custom_content_id` skip telemetry and
      // returns early. Per-callsite fast paths previously here suppressed
      // that central event, hiding the highest-volume class of skips.
      if(globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()) {
        await createAttachmentIfContentChanged(graphXml ?? '', 'graph');
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
  await ensureDrawioViewerLoaded();
  await runViewerLoadLifecycle({
    macroType: 'graph',
    initializeContext: () => globals.apWrapper.initializeContext(),
    getContext: initForgeContext,
    adapter: graphViewerAdapter,
    loadingDocument: NULL_DIAGRAM,
    mountLoadingBeforeCache: true,
    mount: async (doc, reporter) => {
      const paywalled = await tryFullscreenViewerPaywall({
        doc,
        content: ForgeGraphViewer,
        macroKind: 'graph',
        viewerRenderReporter: reporter,
      });
      if (!paywalled) {
        mountRoot(doc, ForgeGraphViewer, {}, { viewerRenderReporter: reporter });
      }
    },
    afterFreshLoad: afterLoad,
    onError: (error) => {
      console.error('Error loading graph viewer', error);
    },
  });
}


export default initializeMacro();

EventBus.$on('edit', async () => {
  // Same-page duplicate gate — the viewer load no longer scans the page ADF,
  // so this click is where a shared customContentId is caught. The guard is
  // memoized: forgeIndex.ts's shared-entry listener fires on this same click
  // and consults it too, but the page GET is paid once.
  const ctx = await initForgeContext();
  if (!(await guardEditClick({
    customContentId: ctx.extension?.config?.customContentId,
    macroType: 'graph',
  }))) return;

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
