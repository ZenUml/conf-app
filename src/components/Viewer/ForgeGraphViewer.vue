<template>
  <div id="forge-graph-viewer">
    <!-- :wide="true" forces viewer-frame--wide (width:100%) so the embedded
         DrawIO viewer has a fixed container to fit to. See ZEN-1168 follow-up. -->
    <generic-viewer :wide="true">
      <!-- inline width:100% is load-bearing: GraphViewer's addSizeHandler
           (else branch) calls updateContainerWidth(bounds.width) and grows the
           container to the diagram's natural width when container.style.width
           is empty (widthIsEmpty=true). Setting it inline keeps the container
           at parent width and lets GraphViewer's positionGraph fitGraph()
           scale wide diagrams down to fit. See ZEN-1168. -->
      <div class="graph-viewport">
        <div ref="graphContainer" class="graph-viewer-canvas" data-diagram-capture-root style="width:100%"></div>
        <DiagramViewportToolbar
          v-if="showZoomControls"
          macro-type="graph"
          label="Graph"
          @zoom-in="zoomIn"
          @zoom-out="zoomOut"
        />
      </div>
      <template v-if="pageCount > 1" #pill-prefix>
        <button
          @click="goToPage(currentPage - 1)"
          :disabled="currentPage <= 0"
          title="Previous page"
          aria-label="Previous page"
          class="viewer-pill-btn"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <span class="viewer-pill-page-indicator" aria-live="polite">
          {{ currentPage + 1 }} / {{ pageCount }}
        </span>
        <button
          @click="goToPage(currentPage + 1)"
          :disabled="currentPage >= pageCount - 1"
          title="Next page"
          aria-label="Next page"
          class="viewer-pill-btn"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
        <span class="viewer-pill-divider" aria-hidden="true"></span>
      </template>
    </generic-viewer>
  </div>
</template>

<script>
import GenericViewer from "@/components/Viewer/GenericViewer.vue";
import DiagramViewportToolbar from "@/components/Viewer/DiagramViewportToolbar.vue";
import { trackRenderTime } from "@/utils/analytics/trackRenderTime";
import EventBus from "@/EventBus";
import { trackViewerRenderCrash } from "@/utils/analytics/trackViewerRenderCrash";
import {
  isLegacyBoardDocument,
  resolveGraphEditorMode,
  resolveGraphXmlForMode,
  validateBoardXml,
} from "@/utils/graph/boardDocument";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { getForgeCustomContentId, setViewerLoadState } from "@/utils/viewerLoadOutcome";
import { createWheelStepper, isZoomIntent } from "@/utils/viewport/wheelZoom";
export default {
  name: "ForgeGraphViewer",
  components: {
    GenericViewer,
    DiagramViewportToolbar
  },
  props: {
    graphXml: String,
    graphEditorMode: {
      type: String,
      default: 'diagram',
    },
  },
  data() {
    return {
      graphViewer: null,
      captureResizeObserver: null,
      currentPage: 0,
      pageCount: 0,
      graphRendered: false,
      wheelZoomHandler: null,
    };
  },
  mounted() {
    this.renderViewer();
  },
  beforeUnmount() {
    this.captureResizeObserver?.disconnect();
    this.captureResizeObserver = null;
    this.disableWheelZoom();
  },
  computed: {
    // Same rule as DiagramViewport: the Export PNG host renders the diagram only
    // to photograph it, and a zoom would change what `updateCaptureBox` reports.
    showZoomControls() {
      return this.graphRendered
        && window.forgeGlobal?.forgeContext?.extension?.modal?.openExport !== true;
    },
    isBoardMode() {
      return resolveGraphEditorMode(this.$store.state.diagram, this.graphEditorMode) === 'board';
    },
    effectiveGraphXml() {
      const diagram = this.$store.state.diagram;
      if (this.isBoardMode) {
        // Board is an independent document, EXCEPT for macros published in
        // Board mode before boardGraphXml existed — those stored their body
        // in graphXml and resolveGraphXmlForMode returns it. A Board document
        // that exists but is empty stays an error rather than falling back.
        return resolveGraphXmlForMode(diagram, 'board');
      }
      return this.graphXml || diagram?.graphXml;
    }
  },
  watch: {
    effectiveGraphXml() {
      this.renderViewer();
    }
  },
  methods: {
    failBoardLoad(errorCode, cause) {
      const loadError = { errorClass: 'malformed', errorCode, terminal: true };
      const state = getForgeCustomContentId()
        ? 'failed_with_source'
        : 'failed_without_source';
      setViewerLoadState(state, loadError);
      // GenericViewer's generic load_failed_shown cannot separate an invalid
      // Board document from a 404, so name the reason here.
      trackAnalyticsEvent('graph_board_document_invalid', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: 'graph',
        error_code: errorCode,
      });
      if (cause) {
        console.error('ForgeGraphViewer: Board document is not renderable:', cause);
      }
    },
    renderViewer() {
      this.graphRendered = false;
      const container = this.$refs.graphContainer;
      const diagram = this.$store.state.diagram;
      if (container) {
        delete container.dataset.captureBoxWidth;
        delete container.dataset.captureBoxHeight;
      }
      if (this.isBoardMode && !isLegacyBoardDocument(diagram)) {
        const boardXml = diagram?.boardGraphXml;
        // bootstrapForgeViewer mounts NULL_DIAGRAM while the authoritative
        // Board document is loading. Do not turn that loading shell into a
        // terminal error; the loader will publish the real Board document (or
        // its explicit loadError) when the fetch completes.
        if (this.$store.state.diagramLoadComplete === false && boardXml === undefined) {
          return;
        }
        const errorCode = validateBoardXml(boardXml);
        if (errorCode) {
          this.failBoardLoad(errorCode);
          return;
        }
      }
      if (!container || !this.effectiveGraphXml) return;
      container.innerHTML = '';
      try {
        // GraphViewer accepts <mxfile> (multi-page) and raw <mxGraphModel>
        // (legacy single-page) via its Editor.extractGraphModel pipeline.
        // We omit the 'toolbar' config so GraphViewer doesn't render its own
        // page-nav strip — page nav is rendered into the GenericViewer
        // bottom pill via the #pill-prefix slot above.
        // @ts-ignore
        const parsedXml = mxUtils.parseXml(this.effectiveGraphXml);
        const xmlNode = parsedXml?.documentElement;
        // @ts-ignore
        this.graphViewer = new GraphViewer(container, xmlNode, {
          'auto-fit': true,
          'border': 10,
        });
        // GraphViewer intentionally keeps this canvas at 100% width. Export
        // needs the rendered graph box, not that fullscreen layout column.
        // mxGraphView.graphBounds are already in view-scaled CSS coordinates;
        // multiply by neither graph.view.scale nor any device pixel ratio.
        this.updateCaptureBox();
        this.captureResizeObserver?.disconnect();
        if (typeof ResizeObserver !== 'undefined') {
          this.captureResizeObserver = new ResizeObserver(() => this.updateCaptureBox());
          this.captureResizeObserver.observe(container);
        }
        this.enablePanning();
        this.enableWheelZoom();
        this.graphRendered = true;
        this.pageCount = this.graphViewer.diagrams?.length || 0;
        this.currentPage = this.graphViewer.currentPage || 0;
        trackRenderTime('graph', this.$store.getters.isDisplayMode);
        // Graph emits no 'diagramLoaded' (that event belongs to the text-DSL
        // renderers). An export-entry Fullscreen open waits for this before it
        // opens the export dialog, so the dialog's first capture is of a
        // painted diagram rather than an empty container.
        EventBus.$emit('viewerRenderSettled', 'graph');
      } catch (e) {
        this.graphRendered = false;
        console.error('ForgeGraphViewer: GraphViewer init failed:', e);
        if (this.isBoardMode) {
          this.failBoardLoad('board_document_malformed', e);
        }
        // reliability-audit-2026-08-06 §4/§12.2 (conf-app#149/#150): trackRenderTime
        // above sits inside this same try block, so a crash here previously
        // fired NEITHER a success nor a failure event — a broken graph macro
        // was invisible on both sides of any Mixpanel ratio. This is the
        // failure side; it must fire even though macro_viewed above did not.
        trackViewerRenderCrash('graph', this.$store.getters.isDisplayMode, e);
      }
    },
    // GraphViewer's built-in 'zoom' toolbar item does exactly this
    // (viewer-static.min.js, addToolbar). We drive the same mxGraph calls from our
    // own chip instead of enabling that toolbar, because `zoomEnabled` is derived
    // from the toolbar config and flips GraphViewer into `resizeContainer = true`
    // — the container would grow with every zoom step and push the page around,
    // and the auto-refit that keeps a wide diagram fitted (ZEN-1168) is only
    // installed while zoom is disabled.
    zoomIn() {
      this.graphViewer?.graph?.zoomIn();
      this.updateCaptureBox();
    },
    zoomOut() {
      this.graphViewer?.graph?.zoomOut();
      this.updateCaptureBox();
    },
    /**
     * Drag to pan. The graph is clipped by the container, so without this the only
     * way to reach an off-screen corner of a zoomed-in diagram is the scrollbar
     * GraphViewer's own size handler puts there.
     */
    enablePanning() {
      const graph = this.graphViewer?.graph;
      if (!graph?.panningHandler) return;
      graph.setPanning(true);
      graph.panningHandler.useLeftButtonForPanning = true;
      // Panning starts only past mxGraph's drag tolerance, so a click still lands
      // on the cell underneath and GraphViewer's link handling is unaffected.
      graph.panningHandler.ignoreCell = true;
    },
    /**
     * Ctrl/Cmd + wheel to zoom, the same rule the other three viewports follow —
     * a plain wheel is left to scroll the page (see `isZoomIntent`). That is also
     * what mxGraph's own wheel handling would have asked for: GraphViewer leaves
     * `Graph.zoomWheel` false, which requires Alt or Ctrl to be held.
     *
     * Still not `mxEvent.addMouseWheelListener` though — it offers no way to
     * unbind, and the container element outlives a re-render (only its children
     * are cleared), so every `renderViewer()` would stack another listener and
     * multiply the step.
     *
     * A native listener also covers trackpad pinch for free: browsers report it as
     * a wheel event with `ctrlKey` set. The accumulate-to-a-step behaviour and the
     * deltaMode normalisation live in `wheelZoom.ts`, shared with the others.
     */
    enableWheelZoom() {
      const container = this.$refs.graphContainer;
      if (!container || this.wheelZoomHandler) return;
      const step = createWheelStepper((direction) => {
        const graph = this.graphViewer?.graph;
        if (direction > 0) graph.zoomIn();
        else graph.zoomOut();
      });
      this.wheelZoomHandler = (event) => {
        if (!this.graphViewer?.graph || !isZoomIntent(event)) return;
        event.preventDefault();
        step(event, container.clientHeight);
        this.updateCaptureBox();
      };
      // Not passive: a zoom has to take the event away from page scroll. Only
      // the zoom branch above does, so an ungated wheel still reaches the page.
      container.addEventListener('wheel', this.wheelZoomHandler, { passive: false });
    },
    disableWheelZoom() {
      if (!this.wheelZoomHandler) return;
      this.$refs.graphContainer?.removeEventListener('wheel', this.wheelZoomHandler);
      this.wheelZoomHandler = null;
    },
    goToPage(index) {
      if (!this.graphViewer || index < 0 || index >= this.pageCount) return;
      this.graphViewer.selectPage(index);
      this.currentPage = index;
      this.updateCaptureBox();
    },
    updateCaptureBox() {
      const container = this.$refs.graphContainer;
      const graph = this.graphViewer?.graph;
      const bounds = graph?.getGraphBounds?.();
      const border = graph?.border || 0;
      if (!container || !bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
        if (container) {
          delete container.dataset.captureBoxWidth;
          delete container.dataset.captureBoxHeight;
        }
        return;
      }
      container.dataset.captureBoxWidth = String(bounds.width + 2 * border);
      container.dataset.captureBoxHeight = String(bounds.height + 2 * border);
    }
  }
}
</script>

<style scoped>
/* Positioning context for the floating zoom chip. No width/height of its own: the
   canvas inside keeps sizing itself, which is what GraphViewer expects. */
.graph-viewport {
  position: relative;
  width: 100%;
}
.graph-viewer-canvas {
  width: 100%;
  min-height: 0;
}
.viewer-pill-page-indicator {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #44546f;
  user-select: none;
  white-space: nowrap;
}
.viewer-pill-divider {
  display: inline-block;
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: rgba(9, 30, 66, 0.14);
  align-self: center;
}
</style>
