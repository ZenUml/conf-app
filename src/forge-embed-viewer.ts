import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import globals from '@/model/globals';
import ForgeEmbedViewer from "@/components/Viewer/ForgeEmbedViewer.vue";
import EventBus from './EventBus'
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import { type Diagram, getDiagramData, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import { mountRoot } from '@/mount-root';
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import { runViewerLoadLifecycle } from '@/utils/viewerLoadLifecycle';
import { embedViewerAdapter } from '@/utils/viewerAdapters/embedViewerAdapter';

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
  await runViewerLoadLifecycle({
    macroType: 'embed',
    initializeContext: () => globals.apWrapper.initializeContext(),
    getContext: initForgeContext,
    adapter: embedViewerAdapter,
    loadingDocument: NULL_DIAGRAM,
    mountLoadingBeforeCache: true,
    mount: async (doc, reporter) => {
      const paywalled = await tryFullscreenViewerPaywall({
        doc,
        content: ForgeEmbedViewer,
        macroKind: 'embed',
        viewerRenderReporter: reporter,
      });
      if (!paywalled) {
        mountRoot(doc, ForgeEmbedViewer, {}, { viewerRenderReporter: reporter });
      }
    },
    afterFreshLoad: afterLoad,
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
