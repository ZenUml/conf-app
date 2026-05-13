<template>
  <div id="forge-graph-viewer">
    <!-- :wide="true" forces viewer-frame--wide (width:100%) instead of --auto
         (fit-content). Without this, the inline DrawIO SVG renders at its
         natural width and the fit-content frame wraps to that width, so
         graph.fit() has no fixed container to fit to. See ZEN-1168 follow-up. -->
    <generic-viewer :wide="true">
      <div ref="graphContainer" style="width:100%;height:100%;"></div>
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

    // Assume mxClient.js and related scripts are globally available
    if (this.$refs.graphContainer && this.graphXml) {
      // @ts-ignore
      const graph = new window.Graph(this.$refs.graphContainer);
      // Do NOT set resizeContainer=true — that makes the container grow to the
      // diagram's natural width and overflows the fixed-width Forge iframe with
      // no horizontal scroll (see ZEN-1168). Leave the container at its
      // parent-driven size and scale the graph to fit via graph.fit() below.
      graph.setEnabled(false);
      // Allow downscaling for wide diagrams; cap upscale at 1 so small
      // diagrams aren't blown up beyond their natural size.
      graph.minFitScale = null;
      graph.maxFitScale = 1;
      // @ts-ignore
      setGraphStyle('./drawio/styles/default.xml', graph);
      // @ts-ignore
      setGraphXml(this.graphXml, graph);
      try {
        graph.fit(/* border */ 10);
      } catch (fitErr) {
        console.warn('ForgeGraphViewer: graph.fit() failed (likely empty graph):', fitErr);
      }
    }
  }
}
</script> 