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
export default {
  name: "ForgeGraphViewer",
  components: {
    GenericViewer
  },
  props: {
    graphXml: String
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
  methods: {
    renderViewer() {
      const container = this.$refs.graphContainer;
      if (!container || !this.graphXml) return;
      try {
        // GraphViewer accepts <mxfile> (multi-page) and raw <mxGraphModel>
        // (legacy single-page) via its Editor.extractGraphModel pipeline.
        // We omit the 'toolbar' config so GraphViewer doesn't render its own
        // page-nav strip — page nav is rendered into the GenericViewer
        // bottom pill via the #pill-prefix slot above.
        // @ts-ignore
        const xmlNode = mxUtils.parseXml(this.graphXml).documentElement;
        // @ts-ignore
        this.graphViewer = new GraphViewer(container, xmlNode, {
          'auto-fit': true,
          'border': 10,
        });
        this.pageCount = this.graphViewer.diagrams?.length || 0;
        this.currentPage = this.graphViewer.currentPage || 0;
      } catch (e) {
        console.error('ForgeGraphViewer: GraphViewer init failed:', e);
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
