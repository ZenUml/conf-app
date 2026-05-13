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
import { extractMxGraphModelForViewer } from "@/model/Graph/extractMxGraphModel";

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
      const setGraphStyle = (styleUrl, graph) => {
        const req = mxUtils.load(styleUrl);
        const root = req.getDocumentElement();
        const dec = new mxCodec(root.ownerDocument);
        dec.decode(root, graph.stylesheet);
      }

      const setGraphXml = (data, graph) => {
        const xmlDoc = mxUtils.parseXml(data);
        const codec = new mxCodec(xmlDoc);
        codec.decode(xmlDoc.documentElement, graph.getModel());
      }

      // Get the graph XML from props or document
      let graphXml = this.graphXml || this.doc?.value?.graphXml || this.doc?.graphXml;
      console.log('ForgeGraphViewerEmbed: original graphXml', graphXml);
      
      // Handle compressed diagrams
      if (this.doc?.compressed || this.doc?.value?.compressed) {
        trackEvent('compressed_field_viewer', 'load', 'warning');
        if (!graphXml?.startsWith('<mxGraphModel')) {
          graphXml = decompress(graphXml);
          trackEvent('compressed_content_viewer', 'load', 'warning');
          console.log('ForgeGraphViewerEmbed: decompressed graphXml', graphXml);
        }
      }
      
      if (this.$refs.graphContainer && graphXml && window.Graph) {
        try {
          // @ts-ignore
          const graph = new window.Graph(this.$refs.graphContainer);
          // Do NOT set resizeContainer=true here — that makes the container grow
          // to the diagram's natural width and causes wide diagrams to overflow
          // the fixed-width Forge iframe, with no horizontal scroll. See ZEN-1168.
          // Instead, leave the container at its parent-driven size and scale the
          // graph to fit via graph.fit() below.
          graph.setEnabled(false);
          // Allow downscaling without limit; cap upscale at 1 so small diagrams
          // aren't blown up beyond their natural size.
          graph.minFitScale = null;
          graph.maxFitScale = 1;
          // @ts-ignore
          setGraphStyle('./drawio/styles/default.xml', graph);
          // @ts-ignore
          setGraphXml(extractMxGraphModelForViewer(graphXml), graph);

          // Fit the diagram to the container after the model is loaded.
          // Wrapped because fit() can throw on degenerate (empty) graphs.
          try {
            graph.fit(/* border */ 10);
          } catch (fitErr) {
            console.warn('ForgeGraphViewerEmbed: graph.fit() failed (likely empty graph):', fitErr);
          }

          this.loading = false;
          console.log('ForgeGraphViewerEmbed: Graph initialized successfully');
        } catch (error) {
          console.error('Failed to initialize graph:', error);
          this.error = 'Failed to initialize graph';
          this.loading = false;
        }
      } else {
        console.error('Missing required data for graph initialization');
        this.error = 'Missing graph data';
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