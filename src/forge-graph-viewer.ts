
// Load external DrawIO scripts dynamically
function loadDrawIOScripts(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const scripts = [
      './drawio/js/sanitizer/purify.min.js',
      './drawio/mxgraph/mxClient.js',
      './drawio/js/grapheditor/Init.js',
      './drawio/js/grapheditor/Graph.js',
      './drawio/js/grapheditor/Shapes.js'
    ];
    
    let loadedCount = 0;
    
    scripts.forEach((src, index) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        loadedCount++;
        if (loadedCount === scripts.length) {
          // Wait for window.Graph to be available
          const checkGraph = () => {
            if (window.Graph) {
              console.log('window.Graph is available:', window.Graph);
              resolve();
            } else {
              console.log('Waiting for window.Graph...');
              setTimeout(checkGraph, 100);
            }
          };
          checkGraph();
        }
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  });
}

import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import globals from '@/model/globals';
import {decompress} from '@/utils/compress';
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import ApWrapper2 from "@/model/ApWrapper2";
import ForgeGraphViewer from "@/components/Viewer/ForgeGraphViewer.vue";
import EventBus from './EventBus'
import {mountRoot} from "@/mount-root";
import macroMetrics from '@/services/MacroMetrics';
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import store from "@/model/store2";
import GraphExample from '@/model/Graph/GraphExample';
import { DataSource, Diagram, DiagramType, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import {
  reportLegacyContentPropertyRestored,
  reportLegacyContentPropertyLoadFailed,
  reportLegacyContentPropertyValueUnexpected,
} from '@/utils/legacyContentPropertyTelemetry';

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
          // ZEN-1170 Defect 1: leave `id` undefined so a subsequent save
          // creates a fresh CustomContent (not a PUT against a bogus id).
          // The migration flag preserves the legacy origin signal for the
          // viewer UI gate + the editor's writeback trigger.
          // ZEN-1170 Defect 1: reuse the Defect 2b `recoveredFromOrphan`
          // flag so the existing READ-ONLY chip + recovery banner + Edit
          // disabled-tooltip in GenericViewer all apply identically. The
          // user-facing meaning is the same: "this was recovered from a
          // backup; to save changes, open the page editor". The recovery
          // SOURCE (sibling CC vs legacy content property) is captured in
          // the telemetry events rather than in the Diagram shape.
          // `id` left undefined so save creates a fresh CustomContent.
          doc = {
            ...(value as Diagram),
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
    }
  }

  store.state.diagram = doc ?? NULL_DIAGRAM;
  window.diagram = doc ?? NULL_DIAGRAM;
  console.log('loadDiagram - window.diagram', window.diagram);

  const contentProps = { graphXml: doc?.graphXml };
  const paywalled = await tryFullscreenViewerPaywall({
    doc,
    content: ForgeGraphViewer,
    contentProps,
    macroKind: 'graph',
  });
  if (!paywalled) {
    mountRoot(doc ?? NULL_DIAGRAM, ForgeGraphViewer, contentProps);
  }

  let graphXml = doc?.graphXml;
  if (doc?.compressed) {
    trackEvent('compressed_field_viewer', 'load', 'warning');
    if (!graphXml?.startsWith('<mxGraphModel')) {
      graphXml = decompress(doc.graphXml);
      trackEvent('compressed_content_viewer', 'load', 'warning');
    }
  }

  // @ts-ignore
  window.updateGraph && window.updateGraph(graphXml || GraphExample.graphXml);

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
  try {
    // Load DrawIO scripts first
    // await loadDrawIOScripts();
    await globals.apWrapper.initializeContext();
    trackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
      macro_type: "graph",
      entry_point: "page_view",
    });
    await loadDiagram();
  } catch (e) {
    console.error('Error loading graph viewer', e);
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
