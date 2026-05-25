import SwaggerUIBundle from 'swagger-ui'
import "swagger-ui/dist/swagger-ui.css";
import SpecListener from './utils/spec-listener'
import './assets/tailwind.css'

import OpenApiExample from '@/model/OpenApi/OpenApiExample'
import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import globals from '@/model/globals';
import OpenApiViewer from "@/components/Viewer/OpenApiViewer.vue";
import EventBus from './EventBus'
import {mountRoot} from "@/mount-root";
import macroMetrics from "@/services/MacroMetrics";
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import store from "@/model/store2";
import { DataSource, Diagram, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';

// @ts-ignore
window.SwaggerUIBundle = SwaggerUIBundle;

function initSwaggerUi() {
  const elementId = 'swagger-ui';
  const element = document.getElementById(elementId);
  if(element && element.innerHTML.trim()) {
    element.innerHTML = '';
  }

  const ui = SwaggerUIBundle({
    // url: "https://petstore.swagger.io/v2/swagger.json",
    dom_id: `#${elementId}`,
    presets: [
      SwaggerUIBundle.presets.apis,
      // SwaggerUIStandalonePreset
    ],
    plugins: [
      SwaggerUIBundle.plugins.DownloadUrl,
      SpecListener
    ],
    // requestSnippetsEnabled: true,
    // layout: "StandaloneLayout"
  })

  // eslint-disable-next-line
  // @ts-ignore
  window.ui = ui
}

async function loadDiagram() {

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

  // eslint-disable-next-line
  // @ts-ignore
  window.updateSpec(doc?.code || OpenApiExample);

  setTimeout(async function () {
    try {
      // Skip attachment write for PNG-recovered docs: CC is confirmed 404,
      // re-uploading here would stamp stale recovered bytes as the current backup.
      if(globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()
          && doc?.source !== DataSource.PngAttachment) {
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
  await globals.apWrapper.initializeContext();
  trackAnalyticsEvent("macro_viewed", {
    feature_area: "macro",
    surface: "viewer",
    macro_type: "openapi",
    entry_point: "page_view",
  });

  // Initialize with empty doc, will be loaded in loadDiagram.
  // Fullscreen viewer paywall wraps OpenApiViewer underneath the modal
  // when triggered; #swagger-ui still lives inside OpenApiViewer's
  // template, so initSwaggerUi() resolves it after the wrapped mount.
  const paywalled = await tryFullscreenViewerPaywall({
    doc: NULL_DIAGRAM,
    content: OpenApiViewer,
    macroKind: 'openapi',
  });
  if (!paywalled) {
    mountRoot(NULL_DIAGRAM, OpenApiViewer);
  }
  initSwaggerUi();

  await loadDiagram();
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

