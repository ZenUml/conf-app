<template>
  <div id="forge-graph-editor">
    <iframe
      ref="drawioFrame"
      src="https://conf-full.zenuml.com/drawio/index.html?embed=1&spin=1&proto=json&noSaveBtn=1&publishClose=1&libraries=1&offline=1"
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

const EMPTY_GRAPH = `<mxfile>
  <diagram name="Page-1">
    <mxGraphModel dx="1434" dy="540" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

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
				const initialGraphXml = this.graphXml || EMPTY_GRAPH;
				loadGraph(initialGraphXml);
			}
			else if(payload.event === 'save') {
				window.graphXml = toGraphModel(payload.xml);
				await this.saveGraphAndExit(window.graphXml);
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