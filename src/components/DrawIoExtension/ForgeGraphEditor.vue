<template>
  <div id="forge-graph-editor">
    <!-- Title row first, in flow, so the iframe below gets the remaining height
         exactly. Previously the title row was position:absolute over the iframe,
         which (a) hid DrawIO's top toolbar under our title and (b) gave DrawIO a
         viewport ~30px taller than the visible area, pushing its bottom toolbar
         below the screen. -->
    <DrawIoExtension :doc="doc" />
    <!-- noExitBtn=1 suppresses DrawIO's standalone "Exit" button. The Atlassian
         header X is the canonical close affordance and onClose autosaves drafts.
         Save & Exit (saveAndExit=1) remains for explicit publish. -->
    <iframe
      ref="drawioFrame"
      src="./drawio/index.html?embed=1&spin=1&proto=json&noSaveBtn=1&saveAndExit=1&noExitBtn=1&libraries=1&offline=1"
      class="drawio-frame"
      @load="onFrameLoad"
    ></iframe>
  </div>
</template>

<script>
import DrawIoExtension from "@/components/DrawIoExtension/DrawIoExtension.vue";
import "@/components/DrawIoExtension/graphEditor.css";
import { getView, getContext as initForgeContext, isInserting } from '@/model/globals/forgeGlobal';
import { setupCloseGuard } from "@/utils/closeGuard";
import { makeDebouncedDraftSaver, loadDraft, clearDraft, primeCloudId, getCachedCloudId, saveDraftSync } from "@/utils/draftStore";
import EventBus from "@/EventBus";

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
  data() {
    return { _drawioModified: false, _closeGuardOff: null, _latestXml: null, _draftSaver: null, _onSaved: null, _draftScope: null };
  },
  beforeUnmount() {
    this._closeGuardOff?.();
    this._draftSaver?.flush();
    if (this._onSaved) EventBus.$off('saved', this._onSaved);
    if (this._onRestore) EventBus.$off('draft-restore', this._onRestore);
  },
  async mounted() {
    await primeCloudId();
    const diagramId = this.$store?.state?.diagram?.id;
    this._draftScope = diagramId ? `edit:${diagramId}` : 'new:graph';
    this._draftSaver = makeDebouncedDraftSaver(this._draftScope, 500);

    // Restore prompt if a newer draft exists in localStorage.
    const draft = await loadDraft(this._draftScope);
    if (draft) {
      const updatedAt = Number(this.$store?.state?.diagram?.updatedAt) || 0;
      const baseline = this.graphXml || '';
      if (draft.savedAt > updatedAt && draft.code !== baseline) {
        EventBus.$emit('draft-available', { scope: this._draftScope, draft });
      } else {
        await clearDraft(this._draftScope);
      }
    }

    // view.onClose: synchronously persist the latest XML if dirty.
    this._closeGuardOff = setupCloseGuard(() => {
      if (!this._drawioModified || !this._latestXml) return;
      const cloudId = getCachedCloudId();
      if (cloudId) {
        saveDraftSync(this._draftScope, cloudId, {
          code: this._latestXml,
          title: this.$store?.state?.diagram?.title || '',
        });
      }
    });

    // Clear draft after successful publish.
    this._onSaved = () => clearDraft(this._draftScope);
    EventBus.$on('saved', this._onSaved);

    // Restore handler: re-load the draft XML into the DrawIO iframe.
    this._onRestore = (payload) => {
      if (payload?.scope !== this._draftScope || !payload?.draft) return;
      try {
        this.sendToFrame({ action: 'load', xml: payload.draft.code });
        if (payload.draft.title) this.$store.dispatch('updateTitle', payload.draft.title);
        this._drawioModified = true;
        this._latestXml = payload.draft.code;
        clearDraft(this._draftScope);
      } catch (e) {
        console.error('[draft-restore] graph restore failed', e);
      }
    };
    EventBus.$on('draft-restore', this._onRestore);
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
			else if(payload.event === 'autosave') {
				this._drawioModified = !!payload.modified;
				if (payload.xml) {
					this._latestXml = payload.xml;
					if (this._drawioModified && this._draftSaver) {
						this._draftSaver.save({
							code: payload.xml,
							title: this.$store?.state?.diagram?.title || '',
						});
					}
				}
			}
			else if(payload.event === 'save') {
				this._drawioModified = false;
				window.graphXml = toGraphModel(payload.xml);
				await window.ensureTitle();
				await this.saveGraphAndExit(window.graphXml);
			}
			// Note: noExitBtn=1 in the iframe URL suppresses DrawIO's standalone
			// Exit button, so we no longer receive payload.event === 'exit'.
			// The Atlassian header X is the canonical close, and view.onClose
			// autosaves a draft via setupCloseGuard above.
		})
  }
}
</script> 