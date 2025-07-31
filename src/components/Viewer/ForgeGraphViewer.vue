<template>
  <div id="forge-graph-viewer">
    <generic-viewer>
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
      graph.resizeContainer = true;
      graph.setEnabled(false);
      // @ts-ignore
      setGraphStyle('styles/default.xml', graph);
      // @ts-ignore
      setGraphXml(this.graphXml, graph);
    }
  }
}
</script> 