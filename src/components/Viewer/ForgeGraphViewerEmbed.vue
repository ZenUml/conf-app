<template>
  <div id="forge-graph-viewer-embed">
    <generic-viewer>
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
      'https://confluence-plugin.pages.dev/drawio/js/sanitizer/purify.min.js',
      'https://confluence-plugin.pages.dev/drawio/mxgraph/mxClient.js',
      'https://confluence-plugin.pages.dev/drawio/js/grapheditor/Init.js',
      'https://confluence-plugin.pages.dev/drawio/js/grapheditor/Graph.js',
      'https://confluence-plugin.pages.dev/drawio/js/grapheditor/Shapes.js'
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
    graphXml: String
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
          graph.resizeContainer = true;
          graph.setEnabled(false);
          // @ts-ignore
          setGraphStyle('https://confluence-plugin.pages.dev/drawio/styles/default.xml', graph);
          // @ts-ignore
          setGraphXml(graphXml, graph);
          
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