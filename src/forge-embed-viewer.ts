import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import type { MacroTypeValue } from "@/utils/analytics/catalog";
import globals from '@/model/globals';
import ForgeEmbedViewer from "@/components/Viewer/ForgeEmbedViewer.vue";
import EventBus from './EventBus'
import {mountRoot} from "@/mount-root";
import macroMetrics from '@/services/MacroMetrics';
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import store from "@/model/store2";
import { Diagram, DiagramType, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import { reportOrphanObserved, reportCustomContentLoadSucceeded } from '@/utils/orphanTelemetry';

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
      reportOrphanObserved(pageId, customContentId, 'embed', loaded.probeResult, {
        recoveryUsed: true,
        recoveredId: loaded.customContent?.id != null ? String(loaded.customContent.id) : undefined,
      });
    } else if (doc) {
      reportCustomContentLoadSucceeded(pageId, customContentId, 'embed');
    } else if (!doc) {
      reportOrphanObserved(pageId, customContentId, 'embed', loaded.probeResult, {
        recoveryUsed: false,
        directFetchStatus: loaded.directFetchStatus,
        directFetchHttpStatus: loaded.directFetchHttpStatus,
        directFetchErrorCode: loaded.directFetchErrorCode,
        directFetchErrorClass: loaded.directFetchErrorClass,
      });
      store.commit('setLoadError', {
        directFetchStatus: loaded.directFetchStatus,
        httpStatus: loaded.directFetchHttpStatus,
        errorCode: loaded.directFetchErrorCode,
        errorClass: loaded.directFetchErrorClass,
      });
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
  try {
    await globals.apWrapper.initializeContext();

    // Initialize with empty doc, will be loaded in loadDiagram
    mountRoot(NULL_DIAGRAM, ForgeEmbedViewer);
    await loadDiagram();
    trackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
      macro_type: store.state.diagram.diagramType as MacroTypeValue,
      entry_point: "page_view",
    });
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
