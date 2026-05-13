<template>
  <div id="forge-graph-editor">
    <!-- noExitBtn=1 suppresses DrawIO's standalone "Exit" button. The Atlassian
         header X is the canonical close affordance and onClose autosaves drafts.
         saveAndExit=1 keeps the explicit-publish button; publishClose=1
         relabels it from "Save & Exit" to "Publish" via mxResources. -->
    <iframe
      ref="drawioFrame"
      src="./drawio/index.html?embed=1&spin=1&proto=json&noSaveBtn=1&saveAndExit=1&publishClose=1&noExitBtn=1&libraries=1&offline=1"
      class="drawio-frame"
      @load="onFrameLoad"
    ></iframe>
    <!-- Title input overlays the iframe at the top-right, positioned to share
         DrawIO's toolbar row visually (matching the official drawio Confluence
         plugin's filename placement). The right offset clears DrawIO's
         Save & Exit button. -->
    <DrawIoExtension :doc="doc" />
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
    return {
      drawioModified: false,
      closeGuardOff: null,
      latestXml: null,
      draftSaver: null,
      savedListener: null,
      draftScope: null,
      restoreListener: null,
    };
  },
  beforeUnmount() {
    this.closeGuardOff?.();
    this.draftSaver?.flush();
    if (this.savedListener) EventBus.$off('saved', this.savedListener);
    if (this.restoreListener) EventBus.$off('draft-restore', this.restoreListener);
  },
  async mounted() {
    await primeCloudId();
    const diagramId = this.$store?.state?.diagram?.id;
    this.draftScope = diagramId ? `edit:${diagramId}` : 'new:graph';
    this.draftSaver = makeDebouncedDraftSaver(this.draftScope, 500);

    // Restore prompt if a newer draft exists in localStorage.
    const draft = await loadDraft(this.draftScope);
    if (draft) {
      const updatedAt = Number(this.$store?.state?.diagram?.updatedAt) || 0;
      const baseline = this.graphXml || '';
      if (draft.savedAt > updatedAt && draft.code !== baseline) {
        EventBus.$emit('draft-available', { scope: this.draftScope, draft });
      } else {
        await clearDraft(this.draftScope);
      }
    }

    // view.onClose: synchronously persist the latest XML if dirty.
    this.closeGuardOff = setupCloseGuard(() => {
      if (!this.drawioModified || !this.latestXml) return;
      const cloudId = getCachedCloudId();
      if (cloudId) {
        saveDraftSync(this.draftScope, cloudId, {
          code: this.latestXml,
          title: this.$store?.state?.diagram?.title || '',
        });
      }
    });

    // Clear draft after successful publish.
    this.savedListener = () => clearDraft(this.draftScope);
    EventBus.$on('saved', this.savedListener);

    // Restore handler: re-load the draft XML into the DrawIO iframe.
    this.restoreListener = (payload) => {
      if (payload?.scope !== this.draftScope || !payload?.draft) return;
      try {
        this.sendToFrame({ action: 'load', xml: payload.draft.code });
        if (payload.draft.title) this.$store.dispatch('updateTitle', payload.draft.title);
        this.drawioModified = true;
        this.latestXml = payload.draft.code;
        clearDraft(this.draftScope);
      } catch (e) {
        console.error('[draft-restore] graph restore failed', e);
      }
    };
    EventBus.$on('draft-restore', this.restoreListener);
		const loadGraph = (xml) => this.sendToFrame({action: 'load', xml});

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
				this.drawioModified = !!payload.modified;
				if (payload.xml) {
					this.latestXml = payload.xml;
					if (this.drawioModified && this.draftSaver) {
						this.draftSaver.save({
							code: payload.xml,
							title: this.$store?.state?.diagram?.title || '',
						});
					}
				}
			}
			else if(payload.event === 'save') {
				this.drawioModified = false;
				// Persist the full <mxfile> wrapper so multi-page diagrams keep
				// every page. Previously we extracted the first <mxGraphModel>
				// and dropped every page after Page-1. Legacy records stored as
				// raw <mxGraphModel> still load — DrawIO's embed setFileData
				// accepts both shapes; the viewer normalizes via
				// extractMxGraphModelForViewer.
				window.graphXml = payload.xml;
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