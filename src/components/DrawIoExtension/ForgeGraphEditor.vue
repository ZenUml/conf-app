<template>
  <div id="forge-graph-editor">
    <iframe
      ref="drawioFrame"
      src="https://confluence-plugin.pages.dev/drawio/index.html?embed=1&spin=1&proto=json&noSaveBtn=1&publishClose=1&libraries=1&offline=1"
      style="width:100%;height:100%;border:0;"
      @load="onFrameLoad"
    ></iframe>
    <DrawIoExtension :doc="doc" />
  </div>
</template>

<script>
import DrawIoExtension from "@/components/DrawIoExtension/DrawIoExtension.vue";
import "@/components/DrawIoExtension/graphEditor.css";
import { getView, getContext as initForgeContext, isInserting } from '@/model/globals/forgeGlobal';

export default {
  name: "ForgeGraphEditor",
  components: {
    DrawIoExtension
  },
  props: {
    graphXml: String,
    saveGraphAndExit: Function,
    doc: Object
  },
  methods: {
    sendToFrame(data) {
      if (this.$refs.drawioFrame) {
        this.$refs.drawioFrame.contentWindow?.postMessage(JSON.stringify(data), '*');
      }
    },
    onFrameLoad() {
      // Send initial graph XML to the iframe
      if (this.graphXml) {
        this.sendToFrame({ action: 'load', xml: this.graphXml });
      }
    }
  },
  mounted() {
		const loadGraph = (xml) => this.sendToFrame({action: 'load', xml});

		function toGraphModel(xmlString) {
			const parser = new DOMParser();
			const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
			const rootElement = xmlDoc.documentElement;
			const modelElement = rootElement.querySelector('mxGraphModel');
			if(!modelElement) {
				throw `<mxGraphModel> not found in ${xmlString}`;
			}

			const serializer = new XMLSerializer();
			return serializer.serializeToString(modelElement);
		}

    //interaction protocol with embeded Drawio frame
		addEventListener('message', async ({data}) => {
      if(!data) {
        console.warn('Empty message sent to drawio editor.');
        return;
      }
			const payload = (typeof data === 'string') && JSON.parse(data);

			if(payload.event === 'init') {
				window.graphXml = window.graphXml || EMPTY_GRAPH;
				loadGraph(window.graphXml);
			}
			else if(payload.event === 'save') {
				window.graphXml = toGraphModel(payload.xml);
				await window.saveAndExit(window.graphXml);
			}
			else if(payload.event === 'exit') {
				if(!payload.modified || !confirm('Diagram modified, close without save?')) {
					await (await getView()).close();
				}
			}
		})
  }
}
</script> 