<template>
  <div id="forge-graph-editor">
    <!-- noExitBtn=1 suppresses DrawIO's standalone "Exit" button. The Atlassian
         header X is the canonical close affordance and onClose autosaves drafts.
         saveAndExit=1 keeps the explicit-publish button; publishClose=1
         relabels it from "Save & Exit" to "Publish" via mxResources. -->
    <iframe
      ref="drawioFrame"
      :src="iframeSrc"
      class="drawio-frame"
      @load="onFrameLoad"
    ></iframe>
    <!-- Title input overlays the iframe at the top-right, positioned to share
         DrawIO's toolbar row visually (matching the official drawio Confluence
         plugin's filename placement). The right offset clears DrawIO's
         Save & Exit button. currentXml feeds the AI auto-title watcher with the
         live diagram content (initial body, then each DrawIO autosave). -->
    <DrawIoExtension :doc="doc" :current-xml="currentXml" />
    <!-- Publishing overlay. The graph macro's Publish button lives INSIDE the
         DrawIO iframe (Save & Exit, relabeled), so unlike the other editors it
         can't show the PublishButton "Publishing…" spinner. Without this,
         clicking Publish gives no feedback while saveGraphAndExit uploads to
         Confluence and redirects (~½s+). This overlay fills that gap and blocks
         further interaction until the modal closes. -->
    <div
      v-if="publishing"
      class="publishing-overlay"
      role="status"
      aria-live="polite"
    >
      <svg class="publishing-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span class="publishing-label">Publishing…</span>
    </div>
  </div>
</template>

<script>
import DrawIoExtension from "@/components/DrawIoExtension/DrawIoExtension.vue";
import "@/components/DrawIoExtension/graphEditor.css";
import { getView, getContext as initForgeContext, isInserting } from '@/model/globals/forgeGlobal';
import { setupCloseGuard } from "@/utils/closeGuard";
import { makeDebouncedDraftSaver, loadDraft, clearDraft, primeCloudId, getCachedCloudId, getCachedSavedVersionUpdatedAt, saveDraftSync, isDraftNewerThanSaved } from "@/utils/draftStore";
import EventBus from "@/EventBus";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { notifyAiTitleSaved } from "@/composables/useAutoTitle";
import {
  buildDrawioEditorSrc,
  captureXmlForModeSwitch,
  normalizeGraphEditorMode,
  setGraphEditorMode,
  wasContentPreserved,
} from "@/utils/graph/graphEditorMode";
import {
  findDrawioMenubar,
  hideDrawioFilename,
  injectGraphModeSwitch,
} from "@/components/DrawIoExtension/graphModeSwitch";

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
    doc: Object,
    customContentId: { type: String, default: undefined },
    graphEditorMode: { type: String, default: 'diagram' },
  },
  computed: {
    // Live diagram content for the AI auto-title watcher: the latest DrawIO
    // autosave xml once the user starts editing, otherwise the initial body.
    currentXml() {
      return this.latestXml || this.graphXml || "";
    },
    iframeSrc() {
      return buildDrawioEditorSrc(this.editorMode);
    }
  },
  methods: {
    sendToFrame(data) {
      if (this.$refs.drawioFrame) {
        this.$refs.drawioFrame.contentWindow?.postMessage(JSON.stringify(data), '*');
      }
    },
    xmlForLoad() {
      return this.pendingModeSwitch?.xml
        || captureXmlForModeSwitch({ latestXml: this.latestXml, graphXml: this.graphXml })
        || EMPTY_GRAPH;
    },
    onFrameLoad() {
      // Send the live (possibly captured-pre-switch) XML. autosave:1 makes
      // DrawIO emit 'autosave' events on every model change.
      const xml = this.xmlForLoad();
      if (xml) {
        this.sendToFrame({ action: 'load', xml, autosave: 1 });
      }
      this.scheduleMountModeSwitch();
    },
    modeSwitchProps(extra) {
      return {
        feature_area: 'macro',
        surface: 'editor',
        macro_type: 'graph',
        ...extra,
      };
    },
    switchGraphEditorMode(toMode) {
      const to = normalizeGraphEditorMode(toMode);
      const from = this.editorMode;
      if (to === from) return;
      const xml = captureXmlForModeSwitch({ latestXml: this.latestXml, graphXml: this.graphXml });
      if (!xml) {
        trackAnalyticsEvent('graph_editor_mode_switch_failed', this.modeSwitchProps({
          from_mode: from,
          to_mode: to,
          failure_stage: 'capture',
          error_code: 'missing_xml',
        }));
        return;
      }
      const hasUnsaved = !!(this.drawioModified || (this.latestXml && this.latestXml !== this.graphXml));
      trackAnalyticsEvent('graph_editor_mode_switch_requested', this.modeSwitchProps({
        from_mode: from,
        to_mode: to,
        has_unsaved_changes: hasUnsaved,
      }));
      this.pendingModeSwitch = { from, to, xml, startedAt: Date.now() };
      this.latestXml = xml;
      setGraphEditorMode(to);
      this.editorMode = to;
    },
    mountModeSwitch(doc) {
      if (this.isUnmounted) return;
      const frameDoc = doc || this.$refs.drawioFrame?.contentDocument;
      if (!frameDoc) return;
      hideDrawioFilename(frameDoc);
      const menubar = findDrawioMenubar(frameDoc);
      if (!menubar) return;
      const menuItems = [...menubar.querySelectorAll('.geMenubar > a, .geMenubar > .geItem')]
      const help = menuItems.find((el) => (el.textContent || '').trim() === 'Help')
        || menuItems[menuItems.length - 1]
      let reservedLeftPx = 0
      if (help) {
        const menubarRect = menubar.getBoundingClientRect()
        const helpRect = help.getBoundingClientRect()
        reservedLeftPx = Math.max(0, helpRect.right - menubarRect.left + 8)
      }
      injectGraphModeSwitch(menubar, {
        mode: this.editorMode,
        onSelect: (mode) => this.switchGraphEditorMode(mode),
        reservedLeftPx,
        reservedRightPx: 300,
      });
    },
    scheduleMountModeSwitch() {
      this.mountTimers.forEach((id) => clearTimeout(id));
      this.mountTimers = [0, 100, 300, 800].map((ms) =>
        setTimeout(() => this.mountModeSwitch(), ms)
      );
    },
    finishPendingModeSwitch(loadedXml) {
      const pending = this.pendingModeSwitch;
      if (!pending) return;
      trackAnalyticsEvent('graph_editor_mode_switch_succeeded', this.modeSwitchProps({
        from_mode: pending.from,
        to_mode: pending.to,
        reload_duration_ms: Date.now() - pending.startedAt,
        content_preserved: wasContentPreserved(pending.xml, loadedXml),
      }));
      this.pendingModeSwitch = null;
    },
  },
  data() {
    const editorMode = normalizeGraphEditorMode(this.graphEditorMode);
    setGraphEditorMode(editorMode);
    return {
      editorMode,
      pendingModeSwitch: null,
      mountTimers: [],
      isUnmounted: false,
      drawioModified: false,
      publishing: false,
      closeGuardOff: null,
      latestXml: null,
      draftSaver: null,
      savedListener: null,
      draftScope: null,
      restoreListener: null,
      messageListener: null,
    };
  },
  created() {
    // Register the DrawIO postMessage listener BEFORE the iframe begins
    // loading. The iframe starts fetching as soon as the component
    // renders to the DOM, and DrawIO inside the iframe emits a one-shot
    // 'init' message when it's ready. If we wait until after `mounted()`
    // finishes its awaits (primeCloudId, loadDraft, …) the 'init' can
    // fire while no listener is attached — the message is dropped,
    // DrawIO stays waiting for a load action that never comes, and the
    // user sees an empty canvas. A subsequent Publish then writes that
    // empty canvas over the customer's real diagram (silent data loss).
    // autosave:1 tells DrawIO to postMessage an 'autosave' event (with the
    // current xml) on every model change. Without it DrawIO only speaks on the
    // explicit 'save', so `latestXml` (and the AI auto-title watcher + local
    // draft saver + close-guard, which all consume these events) would never
    // see live edits. Confluence persistence is unaffected — that still runs
    // only on the 'save' event.
    const loadGraph = (xml) => this.sendToFrame({ action: 'load', xml, autosave: 1 });
    this.messageListener = async ({ data }) => {
      if (!data) {
        console.warn('Empty message sent to drawio editor.');
        return;
      }
      const payload = (typeof data === 'string') && JSON.parse(data);

      if (payload.event === 'init') {
        // Telemetry: existing macro (customContentId set) but graphXml is
        // falsy at init — would have loaded EMPTY_GRAPH over real content
        // before the listener-relocation fix. Should fire ~zero times now;
        // any occurrences indicate a residual wipe-risk path (e.g.
        // decompress fail, partial customContent body) that needs handling.
        if (this.customContentId && !this.graphXml) {
          trackAnalyticsEvent('graph_editor_init_empty', {
            feature_area: 'macro',
            surface: 'editor',
            macro_type: 'graph',
            content_id: this.customContentId,
          });
        }
        const initialGraphXml = this.xmlForLoad();
        loadGraph(initialGraphXml);
        this.scheduleMountModeSwitch();
        this.finishPendingModeSwitch(initialGraphXml);
      }
      else if (payload.event === 'autosave') {
        this.drawioModified = !!payload.modified;
        if (payload.xml) {
          this.latestXml = payload.xml;
          if (this.drawioModified && this.draftSaver) {
            this.draftSaver.save({
              code: payload.xml,
              title: this.$store?.state?.diagram?.title || '',
              graphEditorMode: this.editorMode,
            });
          }
        }
      }
      else if (payload.event === 'save') {
        this.drawioModified = false;
        // Persist the full <mxfile> wrapper so multi-page diagrams keep
        // every page. Previously we extracted the first <mxGraphModel>
        // and dropped every page after Page-1. Legacy records stored as
        // raw <mxGraphModel> still open — DrawIO's embed setFileData
        // and the GraphViewer used in the read path both accept either
        // <mxfile> or raw <mxGraphModel>.
        window.graphXml = payload.xml;
        // ensureTitle may block on user input (title prompt) — only show the
        // "Publishing…" overlay once a title exists and the actual upload starts.
        await window.ensureTitle();
        // Record acceptance if the title still showing is the AI-generated one
        // (no-op when the user typed their own). Mirrors forgeIndex.ts's save
        // handler for the code editors.
        notifyAiTitleSaved({
          title: this.$store?.state?.diagram?.title,
          contentId: this.$store?.state?.diagram?.id,
        });
        this.publishing = true;
        const published = await this.saveGraphAndExit(window.graphXml);
        // On success the redirect (view.submit/close) tears down this modal, so
        // the overlay stays up until it closes. On failure saveGraphAndExit has
        // already toasted and kept the editor open — clear the overlay to retry.
        if (!published) {
          this.publishing = false;
        }
      }
      // Note: noExitBtn=1 in the iframe URL suppresses DrawIO's standalone
      // Exit button, so we no longer receive payload.event === 'exit'.
      // The Atlassian header X is the canonical close, and view.onClose
      // autosaves a draft via setupCloseGuard below.
    };
    window.addEventListener('message', this.messageListener);
  },
  beforeUnmount() {
    this.isUnmounted = true;
    this.mountTimers.forEach((id) => clearTimeout(id));
    this.closeGuardOff?.();
    this.draftSaver?.flush();
    if (this.savedListener) EventBus.$off('saved', this.savedListener);
    if (this.restoreListener) EventBus.$off('draft-restore', this.restoreListener);
    if (this.messageListener) window.removeEventListener('message', this.messageListener);
  },
  async mounted() {
    await primeCloudId();
    const diagramId = this.$store?.state?.diagram?.id;
    this.draftScope = diagramId ? `edit:${diagramId}` : 'new:graph';
    this.draftSaver = makeDebouncedDraftSaver(this.draftScope, 500);

    // Restore prompt if a newer draft exists in localStorage.
    const draft = await loadDraft(this.draftScope);
    if (draft) {
      const baseline = this.graphXml || '';
      const savedVersionUpdatedAt = getCachedSavedVersionUpdatedAt() ?? this.$store?.state?.diagram?.updatedAt;
      if (isDraftNewerThanSaved(draft, savedVersionUpdatedAt) && draft.code !== baseline) {
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
          graphEditorMode: this.editorMode,
        });
      }
    });

    // Clear draft after successful publish.
    this.savedListener = () => {
      this.draftSaver?.cancel();
      clearDraft(this.draftScope);
    };
    EventBus.$on('saved', this.savedListener);

    // Restore handler: re-load the draft XML into the DrawIO iframe.
    this.restoreListener = (payload) => {
      if (payload?.scope !== this.draftScope || !payload?.draft) return;
      try {
        this.sendToFrame({ action: 'load', xml: payload.draft.code, autosave: 1 });
        if (payload.draft.title) this.$store.dispatch('updateTitle', payload.draft.title);
        this.drawioModified = true;
        this.latestXml = payload.draft.code;
        if (payload.draft.graphEditorMode && payload.draft.graphEditorMode !== this.editorMode) {
          this.switchGraphEditorMode(payload.draft.graphEditorMode);
        }
        clearDraft(this.draftScope);
      } catch (e) {
        console.error('[draft-restore] graph restore failed', e);
      }
    };
    EventBus.$on('draft-restore', this.restoreListener);
  }
}
</script>
