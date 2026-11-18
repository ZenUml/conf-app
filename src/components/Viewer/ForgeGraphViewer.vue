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
          @fit-height="fitAxis('height')"
          @fit-width="fitAxis('width')"
        />
      </div>
      <!-- Multi-page navigation, rendered in GenericViewer's header (beside
           the title in Fullscreen) and visible without hover. -->
      <template v-if="pageCount > 1" #header-nav>
        <GraphPageNav :current-page="currentPage" :page-count="pageCount" @go="goToPage" />
      </template>
    </generic-viewer>
  </div>
</template>

<script>
import { reportDiagramReady } from '@/utils/fullscreenReady';
import { ensureDrawioMathForDocument } from '@/utils/drawio/loadDrawioViewer';
import GenericViewer from "@/components/Viewer/GenericViewer.vue";
import GraphPageNav from "@/components/Viewer/GraphPageNav.vue";
import DiagramViewportToolbar from "@/components/Viewer/DiagramViewportToolbar.vue";
import { trackRenderTime } from "@/utils/analytics/trackRenderTime";
import { isLoadedEmptyBody, viewContentState } from "@/utils/analytics/contentState";
import { DiagramType } from "@/model/Diagram/Diagram";
import EventBus from "@/EventBus";
import { trackViewerRenderCrash } from "@/utils/analytics/trackViewerRenderCrash";
import {
  isLegacyBoardDocument,
  resolveGraphEditorMode,
  resolveGraphXmlForMode,
  validateBoardXml,
} from "@/utils/graph/boardDocument";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { clearExternalIconState, startExternalIconProxy } from "@/utils/graph/externalIcons";
import { getForgeCustomContentId, setViewerLoadState } from "@/utils/viewerLoadOutcome";
import {
  alignOf, axisOffset, bindSafariPinch, clampScale, classifyWheel, createGestureGate, zoomLimits,
} from "@/utils/viewport/wheelZoom";
import { trackViewportControl } from "@/utils/viewport/trackViewportControl";
import { wheelFallsThroughToPage } from "@/utils/viewport/surface";

/** The step DrawIO's own toolbar zoom uses (mxGraph zoomFactor). */
const GRAPH_ZOOM_STEP = 1.2;
export default {
  name: "ForgeGraphViewer",
  components: {
    GenericViewer,
    GraphPageNav,
    DiagramViewportToolbar,
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
      emptyViewReported: false,
      wheelZoomHandler: null,
      unbindPinch: null,
      // Until the reader zooms or pans, the opening view is whatever GraphViewer's
      // auto-fit last produced (it refits on resize), so it is re-read each time.
      userMoved: false,
      openScale: 1,
      alignX: 0.5,
      alignY: 0.5,
    };
  },
  mounted() {
    this.renderViewer();
  },
  beforeUnmount() {
    clearExternalIconState(this.$refs.graphContainer);
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
    },
    // #113: the shell mounts with graphXml '' and the document arrives later.
    // A wiped body is '' too, so effectiveGraphXml does not change and the
    // watcher above stays silent. The type flipping from Unknown is the signal
    // that a document landed; emptyViewReported keeps this to one report.
    '$store.state.diagram.diagramType'() {
      if (!this.effectiveGraphXml && !this.emptyViewReported) this.renderViewer();
    },
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
      if (!container) return;
      // A previous render's icon proxy result must not gate this render's capture.
      clearExternalIconState(container);
      // Classify the effective document (including Board/prop overrides) before
      // parsing: whitespace is empty even if DrawIO rejects it. Rendering and
      // its failure telemetry retain their existing path.
      const emptyBody = isLoadedEmptyBody({ ...diagram, graphXml: this.effectiveGraphXml }, DiagramType.Graph);
      if (!this.emptyViewReported && emptyBody) {
        this.emptyViewReported = true;
        trackRenderTime('graph', this.$store.getters.isDisplayMode, 'live_render', 'none', 'empty');
      }
      if (!this.effectiveGraphXml) return;
      container.innerHTML = '';
      try {
        // GraphViewer accepts <mxfile> (multi-page) and raw <mxGraphModel>
        // (legacy single-page) via its Editor.extractGraphModel pipeline.
        // We omit the 'toolbar' config so GraphViewer doesn't render its own
        // page-nav strip — page nav is rendered into the GenericViewer
        // header via the #header-nav slot above.
        // @ts-ignore
        const parsedXml = mxUtils.parseXml(this.effectiveGraphXml);
        const xmlNode = parsedXml?.documentElement;
        ensureDrawioMathForDocument(xmlNode);
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
        this.userMoved = false;
        this.enablePanning();
        this.enableWheelZoom();
        this.graphRendered = true;
        this.pageCount = this.graphViewer.diagrams?.length || 0;
        this.currentPage = this.graphViewer.currentPage || 0;
        // Classify the XML that was rendered (effectiveGraphXml honours the
        // `graphXml` prop and the Board document), not just store.graphXml.
        if (!emptyBody) {
          trackRenderTime(
            'graph', this.$store.getters.isDisplayMode, 'live_render', 'none',
            viewContentState({ ...diagram, graphXml: this.effectiveGraphXml }, DiagramType.Graph),
          );
        }
        // Graph emits no 'diagramLoaded' (that event belongs to the text-DSL
        // renderers). An export-entry Fullscreen open waits for this before it
        // opens the export dialog, so the dialog's first capture is of a
        // painted diagram rather than an empty container.
        EventBus.$emit('viewerRenderSettled', 'graph');
        if (!emptyBody && !diagram?.loadError) reportDiagramReady(container, 'graph');
        this.loadExternalIcons(container);
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
    /**
     * Icons from icons.diagrams.net: Forge's CSP refuses that host, so they come
     * from our backend as data URLs. The diagram has already rendered and is not
     * held up: the icons are swapped in when the call settles. A failure leaves
     * the diagram without them and makes PNG capture refuse it (captureBlob).
     * Nothing here may break the render, hence the catch.
     */
    loadExternalIcons(container) {
      const viewer = this.graphViewer;
      try {
        startExternalIconProxy({ viewer, container, track: trackAnalyticsEvent });
      } catch (e) {
        console.error('ForgeGraphViewer: external icon proxy could not start:', e);
      }
    },
    // GraphViewer's built-in 'zoom' toolbar item would call graph.zoomIn/zoomOut.
    // We drive the view from our own chip instead of enabling that toolbar,
    // because `zoomEnabled` is derived from the toolbar config and flips
    // GraphViewer into `resizeContainer = true` — the container would grow with
    // every zoom step and push the page around, and the auto-refit that keeps a
    // wide diagram fitted (ZEN-1168) is only installed while zoom is disabled.
    // Not graph.zoomIn itself either: it zooms about the centre with no limits,
    // and every viewport now shares one floor, ceiling and pan limit.
    zoomIn() {
      const container = this.$refs.graphContainer;
      this.zoomAt(GRAPH_ZOOM_STEP, (container?.clientWidth ?? 0) / 2, (container?.clientHeight ?? 0) / 2);
    },
    zoomOut() {
      const container = this.$refs.graphContainer;
      this.zoomAt(1 / GRAPH_ZOOM_STEP, (container?.clientWidth ?? 0) / 2, (container?.clientHeight ?? 0) / 2);
    },
    /**
     * Read the opening view while the reader has not moved it: the scale is the
     * zoom floor, and where a graph smaller than the box sits is the pan rest.
     */
    captureOpening() {
      const view = this.graphViewer?.graph?.view;
      if (this.userMoved || !(view?.scale > 0)) return;
      this.openScale = view.scale;
      this.captureAlign();
    },
    captureAlign() {
      const graph = this.graphViewer?.graph;
      const container = this.$refs.graphContainer;
      const box = this.graphBox(graph?.view?.scale, graph?.view?.translate?.x, graph?.view?.translate?.y);
      if (!box || !container) return;
      this.alignX = alignOf(box.left, box.width, container.clientWidth);
      this.alignY = alignOf(box.top, box.height, container.clientHeight);
    },
    /**
     * The graph's box in container pixels for a candidate scale and translate,
     * border included. mxGraph screen = (model + translate) * scale.
     */
    graphBox(scale, tx, ty) {
      const graph = this.graphViewer?.graph;
      const view = graph?.view;
      const bounds = graph?.getGraphBounds?.();
      if (!view || !bounds || !(view.scale > 0) || !(scale > 0)) return null;
      const border = graph.border || 0;
      const modelX = bounds.x / view.scale - view.translate.x;
      const modelY = bounds.y / view.scale - view.translate.y;
      return {
        modelX,
        modelY,
        border,
        left: (modelX + tx) * scale - border,
        top: (modelY + ty) * scale - border,
        width: bounds.width / view.scale * scale + 2 * border,
        height: bounds.height / view.scale * scale + 2 * border,
      };
    },
    /** A translate clamped so the graph stays in view (see `axisOffset`). */
    limitTranslate(scale, tx, ty) {
      const container = this.$refs.graphContainer;
      const box = this.graphBox(scale, tx, ty);
      if (!box || !container) return { tx, ty };
      const left = axisOffset(box.left, box.width, container.clientWidth, this.alignX);
      const top = axisOffset(box.top, box.height, container.clientHeight, this.alignY);
      return {
        tx: (left + box.border) / scale - box.modelX,
        ty: (top + box.border) / scale - box.modelY,
      };
    },
    /** Zoom keeping the model point at (x, y), container pixels, under it. */
    zoomAt(factor, x, y) {
      const view = this.graphViewer?.graph?.view;
      if (!(view?.scale > 0)) return;
      this.captureOpening();
      const scale = view.scale;
      const next = clampScale(scale * factor, zoomLimits(this.openScale));
      if (next === scale) return;
      const modelX = x / scale - view.translate.x;
      const modelY = y / scale - view.translate.y;
      const { tx, ty } = this.limitTranslate(next, x / next - modelX, y / next - modelY);
      view.scaleAndTranslate(next, tx, ty);
      this.userMoved = true;
      this.updateCaptureBox();
    },
    /** Move by (dx, dy) container pixels. */
    panBy(dx, dy) {
      const view = this.graphViewer?.graph?.view;
      if (!(view?.scale > 0)) return;
      this.captureOpening();
      const { tx, ty } = this.limitTranslate(view.scale, view.translate.x + dx / view.scale, view.translate.y + dy / view.scale);
      view.setTranslate(tx, ty);
      this.userMoved = true;
      this.updateCaptureBox();
    },
    fitAxis(axis) {
      const graph = this.graphViewer?.graph;
      const container = this.$refs.graphContainer;
      const bounds = graph?.getGraphBounds?.();
      const view = graph?.view;
      if (!container || !view || !bounds || !(view.scale > 0)) return;
      const width = bounds.width / view.scale;
      const height = bounds.height / view.scale;
      const available = axis === 'width' ? container.clientWidth : container.clientHeight;
      const extent = axis === 'width' ? width : height;
      if (!(extent > 0) || !(available > 0)) return;
      const x = bounds.x / view.scale - view.translate.x;
      const y = bounds.y / view.scale - view.translate.y;
      this.captureOpening();
      const scale = clampScale(available / extent, zoomLimits(this.openScale));
      view.scaleAndTranslate(scale,
        (container.clientWidth / scale - width) / 2 - x,
        (container.clientHeight / scale - height) / 2 - y);
      // A fit is a deliberate re-layout: the centred position is the new rest.
      this.userMoved = true;
      this.captureAlign();
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
      // The two flags above are ones GraphViewer already sets, and on their own
      // they never pan here: GraphViewer's setup (viewer-static.min.js) replaces
      // isForcePanningEvent with a gate that forces a left-button pan only while
      // the container is overflow:auto, and this container stays overflow:hidden
      // so zoom clips instead of growing the page. Instrumented on the sandbox
      // graph-view preset: mousedown/move/up all reached the graph, the handler's
      // start() never fired, and view.translate stayed put. Restoring the stock
      // "any non-popup press" rule moves translate by exactly the drag delta.
      // @ts-ignore - mxEvent is a DrawIO global, like mxUtils above
      graph.panningHandler.isForcePanningEvent = (me) => !mxEvent.isPopupTrigger(me.getEvent());
      this.limitDragPan(graph);
    },
    /**
     * The same pan limit for a drag. mxPanningHandler moves the graph in two
     * calls (viewer-static.min.js): `graph.panGraph(dx, dy)` shifts a preview by
     * screen pixels while the button is down, and on release
     * `panningHandler.panGraph(tx, ty)` commits the new translate. Both are
     * limited, so the preview never shows a position the release would undo.
     */
    limitDragPan(graph) {
      if (graph.zenumlPanLimited) return;
      graph.zenumlPanLimited = true;
      const preview = graph.panGraph;
      if (typeof preview === 'function') {
        graph.panGraph = (dx, dy) => {
          const view = graph.view;
          // (0, 0) clears the preview before the commit; it is not a position.
          if ((dx === 0 && dy === 0) || !(view?.scale > 0)) return preview.call(graph, dx, dy);
          this.captureOpening();
          const { tx, ty } = this.limitTranslate(view.scale, view.translate.x + dx / view.scale, view.translate.y + dy / view.scale);
          return preview.call(graph, (tx - view.translate.x) * view.scale, (ty - view.translate.y) * view.scale);
        };
      }
      const handler = graph.panningHandler;
      const commit = handler.panGraph;
      if (typeof commit === 'function') {
        handler.panGraph = (tx, ty) => {
          const view = graph.view;
          if (!(view?.scale > 0)) return commit.call(handler, tx, ty);
          this.captureOpening();
          const limited = this.limitTranslate(view.scale, tx, ty);
          this.userMoved = true;
          const result = commit.call(handler, limited.tx, limited.ty);
          this.updateCaptureBox();
          return result;
        };
      }
    },
    /**
     * The wheel rule all four viewports share (see `classifyWheel`): on the page
     * viewer only Ctrl/Cmd + wheel zooms and a plain wheel scrolls the page; in
     * Fullscreen and the editor preview a plain wheel zooms and Shift or a
     * sideways swipe pans. Zoom is at the pointer.
     *
     * Not `mxEvent.addMouseWheelListener` — it offers no way to unbind, and the
     * container element outlives a re-render (only its children are cleared),
     * so every `renderViewer()` would stack another listener and multiply the
     * zoom. A native listener also covers trackpad pinch: browsers report it as
     * a wheel event with `ctrlKey` set.
     */
    enableWheelZoom() {
      const container = this.$refs.graphContainer;
      if (!container || this.wheelZoomHandler) return;
      const startsGesture = createGestureGate();
      this.wheelZoomHandler = (event) => {
        if (!this.graphViewer?.graph) return;
        const action = classifyWheel(event, {
          plainWheelZooms: !wheelFallsThroughToPage(this.$store.getters.isDisplayMode),
          pageHeight: container.clientHeight,
          pageWidth: container.clientWidth,
        });
        // A plain wheel on the page viewer is the page's to scroll.
        if (action.kind === 'pass') return;
        event.preventDefault();
        if (action.kind === 'pan') {
          this.panBy(action.dx, action.dy);
          return;
        }
        const rect = container.getBoundingClientRect();
        this.zoomAt(action.factor, event.clientX - rect.left, event.clientY - rect.top);
        // One event per gesture, not per wheel event: the gate stays shut for
        // the rest of a continuous scroll, so a wheel zoom costs the same one
        // event as a button click and the two can be compared.
        if (!startsGesture()) return;
        trackViewportControl({
          macroType: 'graph',
          viewportAction: action.factor > 1 ? 'zoom_in' : 'zoom_out',
          viewportInput: 'wheel',
          wheelModifier: action.modifier,
          isDisplayMode: this.$store.getters.isDisplayMode,
        });
      };
      // Listen on the whole canvas, not only the graph container: the container
      // is as tall as the diagram, so in Fullscreen a short diagram leaves blank
      // canvas above and below it that would otherwise ignore the wheel.
      this.wheelTarget = container.closest('.viewer-canvas') || container;
      // Not passive: a zoom has to take the event away from page scroll. Only
      // the zoom and pan branches do, so a page-viewer plain wheel still scrolls.
      this.wheelTarget.addEventListener('wheel', this.wheelZoomHandler, { passive: false });
      this.unbindPinch = bindSafariPinch(this.wheelTarget, (factor, clientX, clientY) => {
        const rect = container.getBoundingClientRect();
        this.zoomAt(factor, clientX - rect.left, clientY - rect.top);
      });
    },
    disableWheelZoom() {
      if (!this.wheelZoomHandler) return;
      this.wheelTarget?.removeEventListener('wheel', this.wheelZoomHandler);
      this.wheelTarget = null;
      this.wheelZoomHandler = null;
      this.unbindPinch?.();
      this.unbindPinch = null;
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
</style>
