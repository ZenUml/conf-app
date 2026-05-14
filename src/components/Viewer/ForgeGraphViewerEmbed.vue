<template>
  <div id="forge-graph-viewer-embed">
    <!-- :wide="true" forces viewer-frame--wide (width:100%) so graph.fit() has
         a fixed container to fit to. Without it, the fit-content frame wraps
         to the SVG's natural width and the diagram still overflows. See
         ZEN-1168 follow-up. -->
    <generic-viewer :wide="true" :hideHeader="hideHeader">
      <div ref="graphContainer" style="width:100%;height:100%;"></div>
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
      error: null
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
        const xmlNode = mxUtils.parseXml(graphXml).documentElement;
        new window.GraphViewer(this.$refs.graphContainer, xmlNode, {
          'toolbar': 'pages',
          'toolbar-position': 'inline',
          'toolbar-nohide': true,
          'auto-fit': true,
          'border': 10,
        });
        this.loading = false;
      } catch (error) {
        console.error('Failed to initialize graph viewer:', error);
        this.error = 'Failed to initialize graph';
        this.loading = false;
      }
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