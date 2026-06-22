import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import globals from '@/model/globals';
import {decompress} from '@/utils/compress';
import ForgeGraphViewer from "@/components/Viewer/ForgeGraphViewer.vue";
import EventBus from './EventBus'
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import { DataSource, Diagram, DiagramType } from "@/model/Diagram/Diagram";
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import {
  reportLegacyContentPropertyRestored,
  reportLegacyContentPropertyLoadFailed,
  reportLegacyContentPropertyValueUnexpected,
} from '@/utils/legacyContentPropertyTelemetry';
import { bootstrapForgeViewer } from '@/utils/viewerBootstrap';
import { ensureDrawioViewerLoaded } from '@/utils/drawio/loadDrawioViewer';

async function loadDiagram(): Promise<Diagram | undefined> {
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
      reportOrphanObserved(pageId, customContentId, 'graph', loaded.probeResult, {
        recoveryUsed: true,
        recoveredId: loaded.customContent?.id != null ? String(loaded.customContent.id) : undefined,
      });
    } else if (!doc) {
      reportOrphanObserved(pageId, customContentId, 'graph', loaded.probeResult, { recoveryUsed: false });
    }
  }

  // ZEN-1170 Defect 1: legacy macros (Connect-era) stored their body in a
  // page content property keyed by config.uuid. The Forge viewer code path
  // lost that fallback, leaving affected legacy pages with an empty iframe.
  // Try the legacy property when custom content didn't produce a doc
  // (whether because customContentId was missing OR because the orphan path
  // didn't recover anything). Key MUST come from config.uuid, not localId
  // (those are different identifiers; the legacy writer used config.uuid).
  if (!doc) {
    const storageUuid = context.extension?.config?.uuid;
    if (storageUuid) {
      const result = await globals.apWrapper.getContentPropertyV2(
        `zenuml-graph-macro-${storageUuid}-body`,
      );
      if (result.status === 'ok') {
        const value = result.property.value;
        if (value && typeof value === 'object') {
          // Legacy V1 storage (Connect-era) compressed graphXml and set
          // `compressed: true` on the property value; the post-Forge CC
          // path stores plain XML. Decompress here so doc.graphXml is
          // always plain XML downstream. The viewer reacts to the store update
          // after the shell mount, so publishing compressed bytes would still
          // render blank.
          const restored = value as Diagram & { compressed?: boolean };
          let graphXml = restored.graphXml;
          if (restored.compressed && graphXml && !graphXml.startsWith('<mxGraphModel')) {
            graphXml = decompress(graphXml);
          }
          doc = {
            ...restored,
            graphXml,
            compressed: false,
            diagramType: DiagramType.Graph,
            source: DataSource.ContentProperty,
            id: undefined,
            recoveredFromOrphan: true,
          };
          reportLegacyContentPropertyRestored('viewer', 'graph', storageUuid, { pageId });
        } else if (typeof value === 'string') {
          reportLegacyContentPropertyValueUnexpected('viewer', 'graph', storageUuid, 'string');
        } else {
          reportLegacyContentPropertyValueUnexpected('viewer', 'graph', storageUuid, value == null ? 'null' : 'other');
        }
      } else if (result.status !== 'not_found') {
        reportLegacyContentPropertyLoadFailed('viewer', 'graph', storageUuid, result.status === 'forbidden' ? 'forbidden' : result.status === 'error' ? result.reason : 'thrown', { pageId });
      }

      // ZEN-1170 Defect 1 sibling: cross-page-paste recovery. The content
      // property above lives on THIS page, but a Connect-era macro copy-
      // pasted to a new page has no property here — its body survives only
      // as a CustomContent on the SOURCE page, titled with the uuid. This
      // step finds it by exact-title CQL search and flags isCopy=true so
      // the viewer renders the cross-page warning.
      if (!doc) {
        const recovered = await globals.apWrapper.findLegacyCustomContentByUuid(storageUuid);
        if (recovered?.value) {
          doc = recovered.value;
          doc.recoveredFromOrphan = true;
          trackEvent(storageUuid, 'legacy_custom_content_by_uuid_restored', 'info', {
            surface: 'viewer',
            macro_type: 'graph',
            recovered_id: String(recovered.id ?? ''),
            is_copy: doc.isCopy ? 'true' : 'false',
            ...(pageId && { page_id: pageId }),
          });
        }
      }
    }
  }

  return doc;
}

function afterLoad(doc: Diagram | undefined) {
  // Rendering is driven by the store (publishLoadedDiagram normalizes legacy
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
  // Perf (controllable resource_load ∥ fetch): the DrawIO scripts (our resource)
  // are independent of the Forge context + custom-content fetch, and are only
  // needed once graphXml reaches the store — ForgeGraphViewer.renderViewer() guards
  // on effectiveGraphXml, so the empty-diagram mount never touches DrawIO. Start the
  // DrawIO load CONCURRENTLY with bootstrap's context+fetch and join it just before
  // the diagram is published (which triggers the GraphViewer render), instead of
  // serializing the whole DrawIO load before bootstrap even begins.
  const drawioReady = ensureDrawioViewerLoaded();
  await bootstrapForgeViewer({
    macroKind: 'graph',
    content: ForgeGraphViewer,
    loadDiagram: async () => {
      const doc = await loadDiagram();
      await drawioReady; // DrawIO must be ready before publishLoadedDiagram → render
      return doc;
    },
    afterLoad,
    onError: (error) => {
      console.error('Error loading graph viewer', error);
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
