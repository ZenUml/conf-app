<template>
  <div id="forge-graph-viewer-embed">
    <!-- :wide="true" forces viewer-frame--wide (width:100%) so graph.fit() has
         a fixed container to fit to. Without it, the fit-content frame wraps
         to the SVG's natural width and the diagram still overflows. See
         ZEN-1168 follow-up. -->
    <generic-viewer :wide="true" :hideHeader="hideHeader">
      <div ref="graphContainer" style="width:100%;height:100%;"></div>
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
import { decompress } from '@/utils/compress';
import { trackEvent } from '@/utils/window';

// Load external DrawIO scripts dynamically
function loadDrawIOScripts() {
  return new Promise((resolve, reject) => {
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
              console.log('ForgeGraphViewerEmbed: window.Graph is available:', window.Graph);
              resolve();
            } else {
              console.log('ForgeGraphViewerEmbed: Waiting for window.Graph...');
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

export default {
  name: "ForgeGraphViewerEmbed",
  components: {
    GenericViewer
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
        // Load DrawIO scripts first
        // await loadDrawIOScripts();
        
        // Now initialize the graph
        this.initGraph();
      } catch (error) {
        console.error('Failed to load DrawIO scripts:', error);
        this.error = 'Failed to load graph viewer';
        this.loading = false;
      }
    },
    
    initGraph() {
      let graphXml = this.graphXml || this.doc?.value?.graphXml || this.doc?.graphXml;

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
        // bottom pill via the #pill-prefix slot above.
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
