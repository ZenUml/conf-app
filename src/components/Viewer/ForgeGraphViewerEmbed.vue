<template>
  <div id="forge-graph-viewer-embed">
    <!-- :wide="true" forces viewer-frame--wide (width:100%) so graph.fit() has
         a fixed container to fit to. Without it, the fit-content frame wraps
         to the SVG's natural width and the diagram still overflows. See
         ZEN-1168 follow-up. -->
    <generic-viewer :wide="true" :hideHeader="hideHeader">
      <div ref="graphContainer" style="width:100%;height:100%;"></div>
      <!-- Multi-page navigation, rendered in GenericViewer's header (beside
           the title in Fullscreen) and visible without hover. -->
      <template v-if="pageCount > 1" #header-nav>
        <GraphPageNav :current-page="currentPage" :page-count="pageCount" @go="goToPage" />
      </template>
    </generic-viewer>
  </div>
</template>

<script>
import GenericViewer from "@/components/Viewer/GenericViewer.vue";
import GraphPageNav from "@/components/Viewer/GraphPageNav.vue";
import { decompress } from '@/utils/compress';
import { trackEvent } from '@/utils/window';
import { ensureDrawioViewerLoaded } from '@/utils/drawio/loadDrawioViewer';
import { resolveGraphXml } from '@/utils/graph/boardDocument';

export default {
  name: "ForgeGraphViewerEmbed",
  components: {
    GenericViewer,
    GraphPageNav,
  },
  props: {
    doc: {
      type: Object,
      required: true
    },
    graphXml: String,
    hideHeader: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      loading: true,
      error: null,
      graphViewer: null,
      currentPage: 0,
      pageCount: 0,
    }
  },
  async mounted() {
    await this.initializeGraph();
  },
  methods: {
    async initializeGraph() {
      try {
        await ensureDrawioViewerLoaded();
        this.initGraph();
      } catch (error) {
        console.error('Failed to load DrawIO scripts:', error);
        this.error = 'Failed to load graph viewer';
        this.loading = false;
      }
    },
    
    initGraph() {
      // The embed host has no macro config, so the mode comes off the body
      // (forge-graph-editor.ts writes it on every publish). Without this the
      // embed rendered a Board macro's stale Diagram document, or reported
      // "Missing graph data" for a macro authored in Board mode.
      const body = this.doc?.value ?? this.doc;
      let graphXml = this.graphXml || resolveGraphXml(body);

      // Legacy compressed records — flag still controls decompression.
      if (this.doc?.compressed || this.doc?.value?.compressed) {
        trackEvent('compressed_field_viewer', 'load', 'warning');
        if (!graphXml?.startsWith('<mxGraphModel')) {
          graphXml = decompress(graphXml);
          trackEvent('compressed_content_viewer', 'load', 'warning');
        }
      }

      if (!this.$refs.graphContainer || !graphXml || !window.GraphViewer) {
        this.error = !window.GraphViewer ? 'Graph viewer not loaded' : 'Missing graph data';
        this.loading = false;
        return;
      }

      try {
        // GraphViewer accepts either <mxfile> (multi-page) or raw <mxGraphModel>
        // (legacy single-page) via its Editor.extractGraphModel pipeline.
        // No 'toolbar' config — page nav is rendered into the GenericViewer
        // header via the #header-nav slot above.
        const xmlNode = mxUtils.parseXml(graphXml).documentElement;
        this.graphViewer = new window.GraphViewer(this.$refs.graphContainer, xmlNode, {
          'auto-fit': true,
          'border': 10,
        });
        this.pageCount = this.graphViewer.diagrams?.length || 0;
        this.currentPage = this.graphViewer.currentPage || 0;
        this.loading = false;
      } catch (error) {
        console.error('Failed to initialize graph viewer:', error);
        this.error = 'Failed to initialize graph';
        this.loading = false;
      }
    },
    goToPage(index) {
      if (!this.graphViewer || index < 0 || index >= this.pageCount) return;
      this.graphViewer.selectPage(index);
      this.currentPage = index;
    }
  },
  watch: {
    doc: {
      handler(newDoc) {
        if (newDoc && !this.loading && window.Graph) {
          this.initGraph();
        }
      },
      deep: true
    },
    graphXml: {
      handler(newXml) {
        if (newXml && !this.loading && window.Graph) {
          this.initGraph();
        }
      }
    }
  }
}
</script>

<style scoped>
.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
  font-size: 16px;
  color: #666;
}

.error {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
  font-size: 16px;
  color: #d32f2f;
}

</style>
