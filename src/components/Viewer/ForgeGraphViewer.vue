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
      <div ref="graphContainer" class="graph-viewer-canvas" style="width:100%"></div>
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
import { trackRenderTime } from "@/utils/analytics/trackRenderTime";
import { trackViewerRenderCrash } from "@/utils/analytics/trackViewerRenderCrash";
import {
  isLegacyBoardDocument,
  resolveGraphEditorMode,
  resolveGraphXmlForMode,
  validateBoardXml,
} from "@/utils/graph/boardDocument";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { getForgeCustomContentId, setViewerLoadState } from "@/utils/viewerLoadOutcome";
export default {
  name: "ForgeGraphViewer",
  components: {
    GenericViewer
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
      currentPage: 0,
      pageCount: 0,
    };
  },
  mounted() {
    this.renderViewer();
  },
  computed: {
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
      const container = this.$refs.graphContainer;
      const diagram = this.$store.state.diagram;
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
        this.pageCount = this.graphViewer.diagrams?.length || 0;
        this.currentPage = this.graphViewer.currentPage || 0;
        trackRenderTime('graph', this.$store.getters.isDisplayMode);
      } catch (e) {
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
    goToPage(index) {
      if (!this.graphViewer || index < 0 || index >= this.pageCount) return;
      this.graphViewer.selectPage(index);
      this.currentPage = index;
    }
  }
}
</script>

<style scoped>
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
