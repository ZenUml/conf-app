import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import globals from '@/model/globals';
import ForgeEmbedViewer from "@/components/Viewer/ForgeEmbedViewer.vue";
import EventBus from './EventBus'
import {mountRoot} from "@/mount-root";
import macroMetrics from '@/services/MacroMetrics';
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import store from "@/model/store2";
import { Diagram, NULL_DIAGRAM, getDiagramData, DataSource } from "@/model/Diagram/Diagram";
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import { reportOrphanObserved } from '@/utils/orphanTelemetry';

async function loadDiagram() {
  const context = await initForgeContext();

  let doc: Diagram | undefined;
  const customContentId = context.extension?.config?.customContentId;
  const pageId = context.extension?.content?.id;
  if(!customContentId) {
  } else {
    const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(pageId, customContentId);
    console.log('loadDiagram - customContent', loaded.customContent, 'recoveredFromOrphan?', loaded.recoveredFromOrphanId);
    doc = loaded.customContent?.value;
    if (loaded.recoveredFromOrphanId && doc) {
      doc.recoveredFromOrphan = true;
      doc.recoveredFromOrphanId = loaded.recoveredFromOrphanId;
    } else if (!doc) {
      reportOrphanObserved(pageId, customContentId, 'embed', loaded.probeResult, { recoveryUsed: false });
      // Last-resort: extract diagram source embedded in the PNG attachment.
      // Only on confirmed 404 — transient 403/5xx should fail closed.
      if (pageId && loaded.directFetchStatus === 'not_found') {
        const { tryExtractFromPngAttachment } = await import('@/utils/attachmentRecovery');
        const pngDoc = await tryExtractFromPngAttachment(pageId, customContentId);
        if (pngDoc) doc = pngDoc;
      }
    }
  }
  store.state.diagram = doc ?? NULL_DIAGRAM;
  window.diagram = doc ?? NULL_DIAGRAM;
  console.log('loadDiagram - window.diagram', window.diagram);

  const contentProps = { diagramType: doc?.diagramType, doc };
  const paywalled = await tryFullscreenViewerPaywall({
    doc,
    content: ForgeEmbedViewer,
    contentProps,
    macroKind: 'embed',
  });
  if (!paywalled) {
    mountRoot(doc ?? NULL_DIAGRAM, ForgeEmbedViewer, contentProps);
  }

  setTimeout(async function () {
    try {
      // Skip attachment write for PNG-recovered docs: the custom content is a
      // confirmed 404, so re-uploading a PNG here would write stale content as
      // the current attachment rather than waiting for the user to save a fix.
      if(globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()
          && doc?.source !== DataSource.PngAttachment) {
        await createAttachmentIfContentChanged(doc ? getDiagramData(doc) : '', doc?.diagramType ?? 'embed');
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
  try {
    await globals.apWrapper.initializeContext();
    trackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
      macro_type: "embed",
      entry_point: "page_view",
    });

    // Initialize with empty doc, will be loaded in loadDiagram
    mountRoot(NULL_DIAGRAM, ForgeEmbedViewer);
    await loadDiagram();
  } catch (e) {
    console.error('Error loading embed viewer', e);
  }
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

