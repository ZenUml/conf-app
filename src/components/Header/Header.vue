<template>
  <header class="toolbar header border-b border-gray-200 px-6 py-3 flex items-center gap-3 relative z-10 h-14">
    <div class="flex items-center gap-3 flex-1 min-w-0">
      <TabSwitcher
        v-model="diagramType"
        :options="diagramOptions"
      />
      <DiagramTitleInput />
    </div>
    <div class="flex items-center gap-3 shrink-0">
      <button class="flex items-center gap-1.5 px-2.5 py-1.5 text-gray-500 text-sm font-medium rounded-md hover:text-gray-700 hover:bg-gray-100 transition-colors duration-200"
        @click="openTemplateGallery">
        <LightBulbIcon class="w-4 h-4" />
        <span>Templates</span>
      </button>
      <button class="flex items-center gap-1.5 px-2.5 py-1.5 text-gray-500 text-sm font-medium rounded-md hover:text-gray-700 hover:bg-gray-100 transition-colors duration-200"
        @click="helpClick">
        <QuestionMarkCircleIcon class="w-4 h-4" />
        <span>Help</span>
      </button>
      <div class="h-6 w-px bg-gray-300"></div>
      <div class="relative group/save">
        <publish-button
          :saveAndExit="saveAndExit"
          :disabled="isPublishDisabled"
          :loading="isSaving" />
        <div class="absolute top-full right-0 pt-2 pointer-events-none opacity-0 transition-opacity duration-150"
          :class="isPublishDisabled ? 'group-hover/save:opacity-100' : ''">
          <div class="shadow-lg px-3 py-2 bg-gray-900 text-white text-xs rounded-md max-w-xs w-max">
            {{ publishDisabledHint }}
          </div>
        </div>
      </div>
    </div>
  </header>
  <TemplateGallery
    :visible="isTemplateGalleryOpen"
    :diagram-type="diagramType"
    @close="closeTemplateGallery"
    @select="applyTemplate"
  />
</template>

<script>
import { mapMutations } from "vuex";
import PublishButton from "@/components/PublishButton.vue";
import TabSwitcher from "@/components/TabSwitcher/TabSwitcher.vue";
import { setupCloseGuard } from "@/utils/closeGuard";
import { makeDebouncedDraftSaver, loadDraft, clearDraft, primeCloudId, getCachedCloudId, getCachedSavedVersionUpdatedAt, saveDraftSync, isDraftNewerThanSaved } from "@/utils/draftStore";
import { DiagramType } from "@/model/Diagram/Diagram";
import { getEditorDiagramOptions, getCodeFromDiagram, getStoreUpdateAction } from "@/model/Diagram/DiagramTypeConfig";
import EventBus from "@/EventBus";
import { trackEvent } from "@/utils/window";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { getEditJourneyId, getOrCreateSession } from "@/utils/journeyTracking";
import { openUrl } from "@/model/globals/forgeGlobal";
import LightBulbIcon from '@heroicons/vue/24/outline/LightBulbIcon';
import QuestionMarkCircleIcon from '@heroicons/vue/24/outline/QuestionMarkCircleIcon';
import DiagramTitleInput from "@/components/Header/DiagramTitleInput.vue";
import TemplateGallery from "@/components/TemplateGallery/TemplateGallery.vue";
import { PUBLISH_BLOCK_MESSAGES } from "@/model/editDupGate";

export default {
  name: "Header",
  components: {
    PublishButton,
    TabSwitcher,
    DiagramTitleInput,
    TemplateGallery,
    LightBulbIcon: { render: LightBulbIcon },
    QuestionMarkCircleIcon: { render: QuestionMarkCircleIcon },
  },
  data() {
    return {
      helpUrl: "https://zenuml.com/docs?utm_source=confluence-plugin&utm_medium=help-button&utm_campaign=confluence-plugin",
      originalCode: "",
      diagramOptions: getEditorDiagramOptions(),
      // Drives the Publish button's spinner + disabled state while the async
      // save/publish chain (saveToPlatform → attachment upload → view.submit)
      // is in flight. Without this the button sits inert for 2–8s with no
      // feedback and stays clickable, so an impatient user can double-fire.
      isSaving: false,
      // Starter-template gallery (#334). Replaces the old external "Examples"
      // link (which sent the user to zenuml.com/mermaid.js.org/plantuml.com
      // docs) with an in-product panel of curated, one-click templates.
      isTemplateGalleryOpen: false,
    };
  },
  computed: {
    DiagramType() {
      return DiagramType;
    },
    diagramType: {
      get() {
        return this.$store.state.diagram.diagramType;
      },
      set(value) {
        this.updateDiagramType(value);
        // Save user's tab preference to localStorage
        localStorage.setItem('zenuml-preferred-diagram-type', value);
      }
    },
    currentCode() {
      return getCodeFromDiagram(this.$store.state.diagram, this.diagramType);
    },
    saveAndExit: function () {
      return () => {
        if (!this.$store.state.diagram.title) {
          EventBus.$emit("flash-title-error");
          return;
        }
        if (this.isSaving) return; // guard against double-fire
        this.startSaving();
        EventBus.$emit("save");
      };
    },
    exit: function () {
      return () => {
        const codeChanged = this.currentCode !== this.originalCode;

        // Determine if creating new or editing existing
        const isNew = !this.$store.state.diagram.id;
        const eventAction = isNew ? 'before_create_macro_exit' : 'before_edit_macro_exit';

        // Track exit button click with journey context
        trackEvent("", eventAction, this.diagramType, {
          had_changes: codeChanged,
          title_provided: !!this.$store.state.diagram.title,
          source: "header_exit_button",
          journey_id: getEditJourneyId(),
          session_id: getOrCreateSession(),
          initial_code_length: this.originalCode?.length || 0,
          current_code_length: this.currentCode?.length || 0,
        });

        EventBus.$emit("exit", codeChanged);
      };
    },
    isPublishDisabled: function () {
      return !this.$store.state.diagram.title || !!this.$store.state.publishBlock;
    },
    publishDisabledHint: function () {
      // publishBlock (model/editDupGate.ts): this editor surface cannot link
      // a forked CC back into the macro — publishing here would silently
      // strand the edit. Wins over the title hint.
      const block = this.$store.state.publishBlock;
      if (block) return PUBLISH_BLOCK_MESSAGES[block] || 'Publishing is unavailable for this diagram here.';
      return 'Add a diagram title to publish';
    },
  },
  methods: {
    ...mapMutations(["updateDiagramType"]),
    startSaving() {
      this.isSaving = true;
      // Safety net: if neither `saved` nor `save-error` comes back (e.g. an
      // unexpected hang), release the button so the user isn't stranded on a
      // spinner. Set comfortably above the worst-case happy path: saveToPlatform
      // network time + the 8s save-time attachment cap + the 500ms writeback
      // delay in forgeIndex.ts.
      clearTimeout(this._savingTimeout);
      this._savingTimeout = setTimeout(() => { this.isSaving = false; }, 20000);
    },
    stopSaving() {
      this.isSaving = false;
      clearTimeout(this._savingTimeout);
    },
    // #334: opens the starter-template gallery panel. Keeps the pre-existing
    // "template click" legacy signal (unknown downstream consumers) and adds
    // the new editor_template_gallery_opened event alongside it, rather than
    // replacing one tracker with the other.
    openTemplateGallery() {
      trackEvent("template", "click", this.diagramType);
      trackAnalyticsEvent("editor_template_gallery_opened", {
        feature_area: "macro",
        surface: "editor",
        macro_type: this.diagramType,
        is_new_macro: !this.$store.state.diagram.id,
      });
      this.isTemplateGalleryOpen = true;
    },
    closeTemplateGallery() {
      this.isTemplateGalleryOpen = false;
    },
    // Applies the chosen template's DSL into the current diagram-type's code
    // field via the same store action the CodeMirror editor dispatches on
    // every keystroke (getStoreUpdateAction) — Editor.vue's `watch(code)`
    // then pushes the new doc into the editor. A plain buffer replace: the
    // user can Ctrl/Cmd+Z it in CodeMirror, and nothing reaches Confluence
    // until Publish, so no destructive-overwrite guard is needed here.
    applyTemplate(template) {
      const action = getStoreUpdateAction(this.diagramType);
      if (action) this.$store.dispatch(action, template.dsl);
      trackAnalyticsEvent("editor_template_applied", {
        feature_area: "macro",
        surface: "editor",
        template_id: template.id,
        macro_type: this.diagramType,
        is_new_macro: !this.$store.state.diagram.id,
      });
      this.isTemplateGalleryOpen = false;
    },
    async helpClick() {
      trackEvent("help", "click", this.diagramType);
      await openUrl(this.helpUrl);
    },
  },
  watch: {
    // The gallery overlay covers the TabSwitcher while open, so a mouse
    // click can't reach it — but there's no focus trap, so keyboard/AT
    // navigation could still tab to a hidden tab button and switch
    // diagramType. Closing on change avoids a template list that reacts
    // out from under the user mid-interaction, and keeps `applyTemplate`
    // (which re-reads getStoreUpdateAction(this.diagramType) at click time)
    // acting on the type the user actually opened the panel for.
    diagramType() {
      this.isTemplateGalleryOpen = false;
    },
  },
  async mounted() {
    // Load user's preferred diagram type from localStorage for new diagrams.
    //
    // Skipped when the type was explicitly ASKED for — the byline's type picker
    // and a pasted /new/<type> link both seed the doc and set `typeRequested`
    // (see applyRequestedDiagramType). A remembered preference is a default, and
    // a default must not overrule a choice the user just made: picking Flowchart
    // in the byline opened a Sequence editor for anyone whose last diagram was a
    // sequence, which is most people.
    const isNewDiagram = this.$store.state.diagram.isNew;
    const typeWasRequested = !!this.$store.state.diagram.typeRequested;
    if (isNewDiagram && !typeWasRequested) {
      const savedDiagramType = localStorage.getItem('zenuml-preferred-diagram-type');
      if (savedDiagramType && (savedDiagramType === DiagramType.Sequence || savedDiagramType === DiagramType.Mermaid)) {
        this.updateDiagramType(savedDiagramType);
      }
    }

    // Store original code for change detection on exit
    this.originalCode = this.currentCode;

    // Pre-resolve cloudId so the synchronous onClose path has it.
    await primeCloudId();

    // Scope: distinguishes "draft for new diagram of this type" from
    // "draft for editing this specific custom-content id".
    this._draftScope = this.$store.state.diagram.id
      ? `edit:${this.$store.state.diagram.id}`
      : `new:${this.diagramType}`;
    this._draftSaver = makeDebouncedDraftSaver(this._draftScope, 500);

    // Restore if a newer draft exists than the loaded diagram.
    const draft = await loadDraft(this._draftScope);
    if (draft) {
      const savedVersionUpdatedAt = getCachedSavedVersionUpdatedAt() ?? this.$store.state.diagram.updatedAt;
      if (isDraftNewerThanSaved(draft, savedVersionUpdatedAt) && (draft.code !== this.originalCode || draft.title !== this.$store.state.diagram.title)) {
        EventBus.$emit("draft-available", {
          scope: this._draftScope,
          draft,
        });
      } else {
        // Draft is older than the saved diagram — discard it.
        await clearDraft(this._draftScope);
      }
    }

    // Persist on every change (debounced).
    this._unwatchDraft = this.$watch(
      () => ({ code: this.currentCode, title: this.$store.state.diagram.title }),
      (val) => {
        if (val.code !== this.originalCode || val.title !== '') {
          this._draftSaver?.save({ code: val.code, title: val.title || '' });
        }
      },
    );

    // Wire the platform close hook. ashraf.teleb85 reported the iframe is
    // sometimes destroyed before view.onClose finishes, so we keep the body
    // synchronous: flush the pending debounced write directly to localStorage.
    this._closeGuardOff = setupCloseGuard(() => {
      if (this.currentCode === this.originalCode) return;
      const cloudId = getCachedCloudId();
      if (cloudId) {
        saveDraftSync(this._draftScope, cloudId, {
          code: this.currentCode,
          title: this.$store.state.diagram.title || '',
        });
      }
    });

    // Clear draft + release the Publish button on successful publish. (On the
    // common path view.submit tears the iframe down first, but the viewer-
    // launched modal can stay open, so resetting here matters.)
    this._onPublished = () => {
      this.stopSaving();
      this._draftSaver?.cancel();
      clearDraft(this._draftScope);
    };
    EventBus.$on('saved', this._onPublished);

    // Release the Publish button when a save fails — forgeIndex.ts keeps the
    // dialog open for retry, so without this the spinner would never clear.
    this._onSaveError = () => this.stopSaving();
    EventBus.$on('save-error', this._onSaveError);

    // Restore handler: load the draft into the store + clear it. Uses the
    // diagram-type-specific update action (sequence → updateCode2,
    // mermaid → updateMermaidCode, etc.) so the right code field is set.
    this._onRestore = (payload) => {
      if (payload?.scope !== this._draftScope || !payload?.draft) return;
      const draft = payload.draft;
      const action = getStoreUpdateAction(this.diagramType);
      if (action) this.$store.dispatch(action, draft.code);
      if (draft.title) this.$store.dispatch("updateTitle", draft.title);
      this.originalCode = ''; // force the restored code to be considered dirty
      clearDraft(this._draftScope);
    };
    EventBus.$on('draft-restore', this._onRestore);
  },
  beforeUnmount() {
    this._closeGuardOff?.();
    this._draftSaver?.flush();
    this._unwatchDraft?.();
    clearTimeout(this._savingTimeout);
    if (this._onPublished) EventBus.$off('saved', this._onPublished);
    if (this._onSaveError) EventBus.$off('save-error', this._onSaveError);
    if (this._onRestore) EventBus.$off('draft-restore', this._onRestore);
  },
};
</script>
