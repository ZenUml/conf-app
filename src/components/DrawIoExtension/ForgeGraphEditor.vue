<template>
  <div id="forge-graph-editor" :data-drawio-title="drawioTitle">
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
    <!-- The title is mounted inside DrawIO's native action group, directly
         before Publish. Keeping the title in the iframe means Graph and Board
         share the same toolbar geometry instead of layering a host overlay on
         top of the editor. -->
    <DrawIoExtension ref="drawioExtension" :doc="doc" :current-xml="currentXml" :editor-mode="editorMode" :show-header="false" :focus-title-input="focusDrawioTitleInput" />
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
import store from "@/model/store2";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { notifyAiTitleSaved } from "@/composables/useAutoTitle";
import {
  buildDrawioEditorSrc,
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
    boardGraphXml: String,
    saveGraphAndExit: Function,
    doc: Object,
    customContentId: { type: String, default: undefined },
    graphEditorMode: { type: String, default: 'diagram' },
  },
  computed: {
    // Live diagram content for the AI auto-title watcher: the latest DrawIO
    // autosave xml for the active mode, otherwise that mode's saved body.
    currentXml() {
      return this.xmlForMode(this.editorMode);
    },
    drawioTitle() {
      return store.state.diagram?.title || window.diagram?.title || '';
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
      return this.xmlForMode(this.editorMode) || EMPTY_GRAPH;
    },
    xmlForMode(mode) {
      return mode === 'board' ? this.boardXml : this.diagramXml;
    },
    setXmlForMode(mode, xml) {
      if (typeof xml !== 'string') return;
      if (mode === 'board') this.boardXml = xml;
      else this.diagramXml = xml;
    },
    draftScopeBase() {
      const diagramId = this.$store?.state?.diagram?.id;
      return diagramId ? `edit:${diagramId}` : 'new:graph';
    },
    draftScopeForMode(mode) {
      return `${this.draftScopeBase()}:${normalizeGraphEditorMode(mode)}`;
    },
    /**
     * Pre-Board releases keyed graph drafts without the mode suffix. A draft
     * written by the currently deployed build would otherwise be unreachable
     * after this ships, and never cleared.
     */
    legacyDraftScope() {
      return this.draftScopeBase();
    },
    /**
     * Offer the newest draft for `scope`, or clear it when it is stale.
     * Returns true when a restore prompt was emitted.
     */
    async offerDraftForScope(scope, mode) {
      const draft = await loadDraft(scope);
      if (!draft) return false;
      const baseline = this.xmlForMode(mode) || '';
      const savedVersionUpdatedAt = getCachedSavedVersionUpdatedAt() ?? this.$store?.state?.diagram?.updatedAt;
      if (
        (!draft.graphEditorMode || draft.graphEditorMode === mode)
        && isDraftNewerThanSaved(draft, savedVersionUpdatedAt)
        && draft.code !== baseline
      ) {
        EventBus.$emit('draft-available', { scope, draft });
        return true;
      }
      await clearDraft(scope);
      return false;
    },
    onFrameLoad() {
      // Send the XML belonging to the active mode. Diagram and Board are
      // intentionally independent, so a reload never borrows the other
      // surface's document. autosave:1 makes DrawIO emit 'autosave' events on
      // every model change.
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
      const currentXml = this.xmlForMode(from) || '';
      const savedXml = (from === 'board' ? this.boardGraphXml : this.graphXml) || '';
      const hasUnsaved = !!this.drawioModified || currentXml !== savedXml;
      trackAnalyticsEvent('graph_editor_mode_switch_requested', this.modeSwitchProps({
        from_mode: from,
        to_mode: to,
        has_unsaved_changes: hasUnsaved,
      }));
      this.pendingModeSwitch = {
        from,
        to,
        expectedXml: this.xmlForMode(to) || '',
        startedAt: Date.now(),
      };
      this.drawioModified = false;
      this.draftSaver?.flush();
      this.draftScope = this.draftScopeForMode(to);
      this.draftSaver = makeDebouncedDraftSaver(this.draftScope, 500);
      setGraphEditorMode(to);
      this.editorMode = to;
      // The target mode may hold a draft from an earlier session. Without this
      // it was never offered, and the next publish deleted it.
      void this.offerDraftForScope(this.draftScope, to);
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
        reservedRightPx: 176,
      });
      this.mountDrawioTitle(frameDoc);
    },
    mountDrawioTitle(frameDoc) {
      // Graph's filename/status anchor is in the menubar, while its Publish
      // action lives in DrawIO's separate button container. Anchor on the
      // action itself so this remains correct across Graph and Sketch/Board.
      const publish = frameDoc.querySelector('button.geEmbedBtn.gePrimaryBtn');
      if (!publish?.parentElement) return;
      frameDoc.querySelectorAll('.zenuml-drawio-title-slot').forEach((node) => node.remove());

      const slot = frameDoc.createElement('div');
      slot.className = 'zenuml-drawio-title-slot';
      slot.style.cssText = 'display:flex;align-items:center;min-width:72px;max-width:320px;height:28px;padding:0 6px;border:1px solid transparent;border-radius:4px;box-sizing:border-box;color:#111827;font:600 14px/1 system-ui,sans-serif;';
      const spark = frameDoc.createElement('button');
      spark.type = 'button'; spark.title = 'Generate title with AI';
      spark.style.cssText = 'width:18px;height:18px;margin-right:5px;padding:0;border:0;background:transparent;color:#9CA3AF;cursor:pointer;';
      // Keep the established three-spark AI affordance when moving the title
      // into DrawIO's native toolbar. A text ✦ glyph is not the same icon.
      const sparkIcon = frameDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      sparkIcon.setAttribute('width', '13');
      sparkIcon.setAttribute('height', '13');
      sparkIcon.setAttribute('viewBox', '0 0 24 24');
      sparkIcon.setAttribute('fill', 'none');
      sparkIcon.setAttribute('stroke', 'currentColor');
      sparkIcon.setAttribute('stroke-width', '1.5');
      sparkIcon.setAttribute('stroke-linecap', 'round');
      sparkIcon.setAttribute('stroke-linejoin', 'round');
      sparkIcon.setAttribute('aria-hidden', 'true');
      const sparkPath = frameDoc.createElementNS('http://www.w3.org/2000/svg', 'path');
      sparkPath.setAttribute('d', 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z');
      sparkIcon.appendChild(sparkPath);
      spark.appendChild(sparkIcon);
      const input = frameDoc.createElement('input');
      input.type = 'text'; input.placeholder = 'Name your graph…'; input.value = this.drawioTitle;
      input.style.cssText = 'width:100%;min-width:0;border:0;outline:0;background:transparent;color:#111827;font:inherit;';
      input.addEventListener('input', () => this.$refs.drawioExtension?.handleTitleChange(input.value));
      input.addEventListener('focus', () => { slot.style.background = '#fff'; slot.style.borderColor = '#F08705'; });
      input.addEventListener('blur', () => { slot.style.background = ''; slot.style.borderColor = 'transparent'; });
      spark.addEventListener('click', () => this.$refs.drawioExtension?.onManualGenerate());
      slot.append(spark, input);
      publish.parentElement.insertBefore(slot, publish);
      this.drawioTitleInput = input;

      this.drawioTitleObserver?.disconnect();
      this.drawioTitleObserver = new MutationObserver(() => {
        if (!frameDoc.querySelector('.zenuml-drawio-title-slot')) this.mountDrawioTitle(frameDoc);
      });
      this.drawioTitleObserver.observe(publish.parentElement, { childList: true });
    },
    syncDrawioTitle() {
      if (this.drawioTitleInput && this.drawioTitleInput.value !== this.drawioTitle) this.drawioTitleInput.value = this.drawioTitle;
    },
    focusDrawioTitleInput() {
      this.drawioTitleInput?.focus();
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
      const contentPreserved = pending.expectedXml
        ? wasContentPreserved(pending.expectedXml, loadedXml)
        : !!loadedXml;
      trackAnalyticsEvent('graph_editor_mode_switch_succeeded', this.modeSwitchProps({
        from_mode: pending.from,
        to_mode: pending.to,
        reload_duration_ms: Date.now() - pending.startedAt,
        content_preserved: contentPreserved,
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
      diagramXml: this.graphXml || '',
      // A macro published in Board mode before boardGraphXml existed stored
      // its body in graphXml. Seeding Board from '' opened those macros on a
      // blank canvas. Only the INITIAL mode gets the fallback: switching into
      // Board on a Diagram macro must still start an independent document.
      // An existing empty string is a real, empty Board document and is kept.
      boardXml: this.boardGraphXml
        ?? (editorMode === 'board' ? (this.graphXml || '') : ''),
      draftSaver: null,
      savedListener: null,
      draftScope: null,
      restoreListener: null,
      messageListener: null,
      drawioTitleInput: null,
      drawioTitleObserver: null,
    };
  },
  updated() {
    this.syncDrawioTitle();
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
    // explicit 'save', so the active mode's XML (and the AI auto-title watcher
    // + local draft saver + close-guard, which all consume these events) would
    // never see live edits. Confluence persistence is unaffected — that still
    // runs only on the 'save' event.
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
          this.setXmlForMode(this.editorMode, payload.xml);
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
        this.setXmlForMode(this.editorMode, payload.xml);
        window.graphXml = this.diagramXml;
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
        const published = await this.saveGraphAndExit({
          graphXml: this.diagramXml,
          boardGraphXml: this.boardXml,
        });
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
    this.drawioTitleObserver?.disconnect();
    this.closeGuardOff?.();
    this.draftSaver?.flush();
    if (this.savedListener) EventBus.$off('saved', this.savedListener);
    if (this.restoreListener) EventBus.$off('draft-restore', this.restoreListener);
    if (this.messageListener) window.removeEventListener('message', this.messageListener);
  },
  async mounted() {
    await primeCloudId();
    this.draftScope = this.draftScopeForMode(this.editorMode);
    this.draftSaver = makeDebouncedDraftSaver(this.draftScope, 500);

    // Restore prompt if a newer draft exists in localStorage. Fall back to the
    // pre-Board unsuffixed key so drafts written by the deployed build are
    // still offered once, then cleared.
    const offered = await this.offerDraftForScope(this.draftScope, this.editorMode);
    if (!offered) {
      const legacyScope = this.legacyDraftScope();
      const legacyDraft = await loadDraft(legacyScope);
      if (legacyDraft) {
        const baseline = this.xmlForMode(this.editorMode) || '';
        const savedVersionUpdatedAt = getCachedSavedVersionUpdatedAt() ?? this.$store?.state?.diagram?.updatedAt;
        if (isDraftNewerThanSaved(legacyDraft, savedVersionUpdatedAt) && legacyDraft.code !== baseline) {
          EventBus.$emit('draft-available', { scope: this.draftScope, draft: legacyDraft });
        }
        await clearDraft(legacyScope);
      }
    }

    // view.onClose: synchronously persist the latest XML if dirty.
    this.closeGuardOff = setupCloseGuard(() => {
      if (!this.drawioModified || !this.xmlForMode(this.editorMode)) return;
      const cloudId = getCachedCloudId();
      if (cloudId) {
        saveDraftSync(this.draftScope, cloudId, {
          code: this.xmlForMode(this.editorMode),
          title: this.$store?.state?.diagram?.title || '',
          graphEditorMode: this.editorMode,
        });
      }
    });

    // Clear draft after successful publish.
    const scopeBaseAtMount = this.draftScopeBase();
    this.savedListener = () => {
      this.draftSaver?.cancel();
      // A publish writes both mode documents, so clear both drafts. Derive
      // them from ONE base captured at mount: draftScopeBase() reads
      // diagram.id, which the save itself populates on a brand-new macro, so
      // recomputing it here cleared `edit:<newId>:*` and orphaned the
      // `new:graph:*` drafts the session actually wrote.
      clearDraft(`${scopeBaseAtMount}:diagram`);
      clearDraft(`${scopeBaseAtMount}:board`);
      clearDraft(scopeBaseAtMount);
      if (this.draftScope && this.draftScope !== `${scopeBaseAtMount}:${this.editorMode}`) {
        clearDraft(this.draftScope);
      }
    };
    EventBus.$on('saved', this.savedListener);

    // Restore handler: re-load the draft XML into the DrawIO iframe.
    this.restoreListener = (payload) => {
      if (payload?.scope !== this.draftScope || !payload?.draft) return;
      if (payload.draft.graphEditorMode && payload.draft.graphEditorMode !== this.editorMode) return;
      try {
        this.sendToFrame({ action: 'load', xml: payload.draft.code, autosave: 1 });
        if (payload.draft.title) this.$store.dispatch('updateTitle', payload.draft.title);
        this.drawioModified = true;
        this.setXmlForMode(this.editorMode, payload.draft.code);
        clearDraft(this.draftScope);
      } catch (e) {
        console.error('[draft-restore] graph restore failed', e);
      }
    };
    EventBus.$on('draft-restore', this.restoreListener);
  }
}
</script>
