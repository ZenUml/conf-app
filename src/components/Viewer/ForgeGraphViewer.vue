<template>
  <div id="forge-graph-viewer">
    <!-- :wide="true" forces viewer-frame--wide (width:100%) so the embedded
         DrawIO viewer has a fixed container to fit to. See ZEN-1168 follow-up. -->
    <generic-viewer :wide="true">
      <div ref="graphContainer" class="graph-viewer-canvas"></div>
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
  mounted() {
    this.renderViewer();
  },
  methods: {
    renderViewer() {
      const container = this.$refs.graphContainer;
      if (!container || !this.graphXml) return;
      // GraphViewer accepts either <mxfile> (multi-page) or raw <mxGraphModel>
      // (legacy single-page) — its Editor.extractGraphModel pipeline normalizes
      // both. Page-nav buttons auto-hide when diagrams.length <= 1, so legacy
      // records render with no toolbar at all.
      try {
        // @ts-ignore
        const xmlNode = mxUtils.parseXml(this.graphXml).documentElement;
        // toolbar-nohide=true keeps the page-nav strip visible without
        // hover, so multi-page diagrams advertise their prev / "1 / 2" / next
        // controls up front. The pages token alone auto-hides on single-page
        // diagrams (GraphViewer.js:1374 sets display:none when len <= 1).
        // @ts-ignore
        new GraphViewer(container, xmlNode, {
          'toolbar': 'pages',
          'toolbar-position': 'inline',
          'toolbar-nohide': true,
          'auto-fit': true,
          'border': 10,
        });
      } catch (e) {
        console.error('ForgeGraphViewer: GraphViewer init failed:', e);
      }
    }
  }
}
</script>

<style scoped>
.graph-viewer-canvas {
  width: 100%;
  min-height: 0;
}
</style>
