import "swagger-ui/dist/swagger-ui.css";
import './assets/tailwind.css'

import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import globals from '@/model/globals';
import OpenApiViewer from "@/components/Viewer/OpenApiViewer.vue";
import EventBus from './EventBus'
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import type { Diagram } from "@/model/Diagram/Diagram";
import { bootstrapForgeViewer, type ViewerLoadDiagramResult } from '@/utils/viewerBootstrap';
import { openDocument } from '@/utils/documentOpening/openDocument';
// resolveOpenApiId carries the pasted-deeplink fallback this file used to do
// inline — see openApiTarget.ts.
import { buildOpenApiViewerTarget, resolveOpenApiId } from '@/utils/documentOpening/targets/openApiTarget';
import { mapOpenErrorToLoadError } from '@/utils/viewerLoadOutcome';
// Still needed by the `edit` handler below, which forwards the macro's id into
// the editor modal — that path is not part of the openDocument refactor.
import { resolveEffectiveCustomContentId } from '@/utils/effectiveCustomContentId';
import { guardEditClick } from '@/utils/guardEditClick';

async function loadDiagram(): Promise<ViewerLoadDiagramResult> {
  const context = await initForgeContext();

  const pageId = context.extension?.content?.id;
  const outcome = await openDocument({
    policy: 'read',
    context,
    pageId,
    target: buildOpenApiViewerTarget(),
  });
  if (outcome.kind === 'failed') {
    // Pipeline OpenError → store-level DiagramLoadError at this boundary, so
    // the recovery panel (GenericViewer, store.viewerLoadState) and the
    // openDocument pipeline keep their own vocabularies without a third one.
    return { doc: undefined, loadError: mapOpenErrorToLoadError(outcome.error) };
  }
  return { doc: outcome.document.doc, loadError: null, attribution: outcome.document.attribution };
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
    // Same resolver the TargetSpec above uses (config, falling back to the
    // dashboard modal's carried id) — this also doubles as the SWR cache key,
    // so it must resolve the SAME id `loadDiagram`'s openDocument() call does.
    resolveContentId: (context) => resolveOpenApiId(context)?.contentId,
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
  // Resolved (not a raw config read) so a pasted macro forwards its real id
  // instead of opening the editor as a new-macro session.
  const customContentId = resolveEffectiveCustomContentId(ctx);
  // Same-page duplicate gate — see forge-graph-viewer.ts. Memoized, so the
  // shared forgeIndex listener firing on this same click costs no extra GET.
  if (!(await guardEditClick({ customContentId, macroType: 'openapi' }))) return;


  await openModal({
    resource: 'main',
    onClose: () => {
      location.reload();
    },
    size: 'fullscreen',
    context: {
      macroMode: 'editor',
      ...(customContentId && { customContentId }),
    },
  });
});
