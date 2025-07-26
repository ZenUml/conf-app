<template>
  <div id="forge-graph-viewer">
    <div ref="graphContainer" style="width:100%;height:100%;"></div>
  </div>
</template>

<script>
export default {
  name: "ForgeGraphViewer",
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
    if (setGraphStyle && setGraphXml && this.$refs.graphContainer && this.graphXml) {
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