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
import { bootstrapForgeViewer, type ViewerLoadDiagramResult } from '@/utils/viewerBootstrap';
import { mapCustomContentLoadError } from '@/utils/viewerLoadOutcome';
import { guardEditClick } from '@/utils/guardEditClick';

async function loadDiagram(): Promise<ViewerLoadDiagramResult> {
  const context = await initForgeContext();

  let doc: Diagram | undefined;
  let loadError = null;
  // Read from config (page-macro viewer) AND modal — the dual-format dashboard's
  // View action opens this viewer as a modal carrying the id via
  // modal.customContentId (mirrors forge-asyncapi-viewer). Without the modal
  // fallback, a dashboard View of an OpenAPI doc renders empty.
  const customContentId =
    context.extension?.config?.customContentId
    || context.extension?.modal?.customContentId;
  const pageId = context.extension?.content?.id;
  if(!customContentId) {
  } else {
    // Zero-network viewer copy check — see forge-graph-viewer.ts for the
    // rationale. Measured cost of the scan this drops: 319ms of a 1429ms
    // openapi render p50 (~22%, 7d external).
    const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(
      pageId, customContentId, { copyCheckMode: 'cross-page-only' },
    );
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
      loadError = mapCustomContentLoadError(loaded);
    }
  }

  // ZEN-1170 Defect 1 sibling: cross-page-paste recovery via uuid → CC title.
  // OpenAPI macros never used content properties (no Defect 1 path here),
  // but the Connect-era {uuid, updatedAt}-only param shape exists for them
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
          macro_type: 'openapi',
          recovered_id: String(recovered.id ?? ''),
          is_copy: doc.isCopy ? 'true' : 'false',
          ...(pageId && { page_id: pageId }),
        });
      }
    }
  }

  return { doc, loadError };
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
    // Same id `loadDiagram` reads (config, falling back to the dashboard
    // modal's carried id) above.
    resolveContentId: (context) =>
      context.extension?.config?.customContentId || context.extension?.modal?.customContentId,
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
