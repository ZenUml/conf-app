<template>
  <header class="toolbar header bg-[#F1F3F4] px-6 flex items-center gap-3 relative z-10 h-10">
    <div class="flex items-center gap-3 flex-1 min-w-0">
      <DiagramTitleInput />
    </div>
    <div class="notch">
      <Notch
        v-model="diagramType"
        :items="diagramOptions"
      />
    </div>
    <div class="flex items-center gap-3 shrink-0 ml-auto">
      <button
        v-if="aiChatAvailable"
        class="flex items-center gap-1.5 px-2.5 py-1 h-7 text-sm font-medium rounded-md transition-colors duration-200"
        :class="
          aiChatOpen
            ? 'bg-violet-100 text-violet-800'
            : 'text-gray-500 hover:bg-violet-50 hover:text-violet-700'
        "
        data-testid="ai-chat-toggle"
        @click="$emit('toggle-ai-chat')"
      >
        <SparklesIcon class="w-4 h-4" />
        <span>AI Chat</span>
      </button>
      <button class="flex items-center gap-1.5 px-2.5 py-1 h-7 text-gray-500 text-sm font-medium rounded-md hover:text-gray-700 hover:bg-gray-100 transition-colors duration-200"
        @click="openTemplateGallery()">
        <LightBulbIcon class="w-4 h-4" />
        <span>Templates</span>
      </button>
      <button class="flex items-center gap-1.5 px-2.5 py-1 h-7 text-gray-500 text-sm font-medium rounded-md hover:text-gray-700 hover:bg-gray-100 transition-colors duration-200"
        @click="helpClick">
        <QuestionMarkCircleIcon class="w-4 h-4" />
        <span>Help</span>
      </button>
      <div class="h-5 w-px bg-gray-300"></div>
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
import Notch from "@/components/Notch/Notch.vue";
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
import SparklesIcon from '@heroicons/vue/24/outline/SparklesIcon';
import DiagramTitleInput from "@/components/Header/DiagramTitleInput.vue";
import TemplateGallery from "@/components/TemplateGallery/TemplateGallery.vue";
import { PUBLISH_BLOCK_MESSAGES } from "@/model/editDupGate";
import { getTemplatesForType } from "@/model/Diagram/EditorTemplates";
import { hasAutoOpenedStarterGallery, markStarterGalleryAutoOpened } from "@/utils/starterGallery/autoOpenMarker";
import Example from "@/utils/sequence/Example";
import { isAiChatEnabled } from '@/apis/aiTitleFeatureFlag';

// forgeIndex.ts never mounts a genuinely new Sequence/Mermaid/PlantUml macro
// with an empty code string — it always seeds Example.Sequence / .Mermaid /
// .PlantUml as placeholder content (see forgeIndex.ts's `doc = { code:
// Example.Sequence, ... isNew: true }` fallback). A plain `!currentCode`
// check is therefore never true for the normal "insert a brand-new macro"
// flow, so the auto-open feature below silently never fired until this was
// caught by a real Confluence spot check (2026-08-18 — the actual editor
// showed the seeded "Order Service" sample instead of auto-opening the
// gallery). Treat the untouched seed as equivalent to empty.
const SEED_CODE_BY_TYPE = {
  [DiagramType.Sequence]: Example.Sequence,
  [DiagramType.Mermaid]: Example.Mermaid,
  [DiagramType.PlantUml]: Example.PlantUml,
};
function isBlankOrUntouchedSeed(diagramType, code, isNewDiagram) {
  if (!code) return true;
  return !!isNewDiagram && SEED_CODE_BY_TYPE[diagramType] === code;
}

export default {
  name: "Header",
  props: {
    aiChatOpen: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["toggle-ai-chat"],
  components: {
    PublishButton,
    Notch,
    DiagramTitleInput,
    TemplateGallery,
    LightBulbIcon: { render: LightBulbIcon },
    QuestionMarkCircleIcon: { render: QuestionMarkCircleIcon },
    SparklesIcon: { render: SparklesIcon },
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
      aiChatEnabled: false,
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
        const fromMacroType = this.diagramType;
        if (value !== fromMacroType) {
          const isNewMacro = !this.$store.state.diagram.id;
          trackAnalyticsEvent('macro_type_changed', {
            feature_area: 'macro',
            surface: 'editor',
            macro_type: value,
            from_macro_type: fromMacroType,
            to_macro_type: value,
            operation_mode: isNewMacro ? 'create' : 'edit',
            type_requested: !!this.$store.state.diagram.typeRequested,
            is_new_macro: isNewMacro,
          });
        }
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
    aiChatAvailable: function () {
      return this.aiChatEnabled && this.diagramType !== DiagramType.Graph;
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
    // replacing one tracker with the other. `trigger` defaults to 'manual'
    // (the Templates-button click path); the mounted() auto-open path below
    // calls this with 'auto_first_open' explicitly. The button binds
    // `@click="openTemplateGallery()"` (with parens) rather than a bare
    // method reference, so Vue does NOT pass the native MouseEvent as the
    // `trigger` argument.
    //
    // Onboarding funnel: this is the producer of editor_starter_shown for
    // BOTH triggers. `entry_point` reuses the existing EntryPoint values
    // rather than adding a new one: 'macro_toolbar' for the manual click
    // (unchanged), 'page_editor' for auto-open — the same value forgeIndex.ts
    // already uses for macro_create_started, since auto-open fires at the
    // same "the page editor just opened a brand-new macro" moment. Fired
    // only when the macro is genuinely new and still empty, which is the
    // "starter surface on an empty new macro" condition the event documents.
    // An editing session or a new macro that already has code (e.g. a
    // restored draft) does not fire it, since the starter surface isn't
    // replacing a blank slate there. The legacy "template click" signal only
    // fires for a real click — auto-open didn't originate from one.
    openTemplateGallery(trigger = "manual") {
      if (trigger === "manual") {
        trackEvent("template", "click", this.diagramType);
      }
      const isNewMacro = !this.$store.state.diagram.id;
      trackAnalyticsEvent("editor_template_gallery_opened", {
        feature_area: "macro",
        surface: "editor",
        macro_type: this.diagramType,
        is_new_macro: isNewMacro,
        template_gallery_trigger: trigger,
      });
      if (isNewMacro && isBlankOrUntouchedSeed(this.diagramType, this.currentCode, this.$store.state.diagram.isNew)) {
        trackAnalyticsEvent("editor_starter_shown", {
          feature_area: "macro",
          surface: "editor",
          macro_type: this.diagramType,
          entry_point: trigger === "auto_first_open" ? "page_editor" : "macro_toolbar",
          trigger,
        });
      }
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
    aiChatAvailable: {
      immediate: true,
      handler(visible, wasVisible) {
        if (visible && !wasVisible) {
          trackAnalyticsEvent('ai_chat_button_shown', {
            feature_area: 'ai',
            surface: 'editor',
            macro_type: this.diagramType,
          });
        }
      },
    },
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
    this.aiChatEnabled = await isAiChatEnabled();

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

    // Onboarding funnel: auto-open the starter-template gallery on first
    // entry to an empty NEW macro, instead of a blank canvas. Mixpanel
    // (macro_create_succeeded, 2026-05-18..08-17): 33.6% of tenants that
    // created a first diagram never created a second one.
    //
    // Guarded by all three: create mode (isNewMacro), source empty
    // (this.currentCode, captured above before any draft restore is
    // applied), and the macro type actually has templates (Graph/OpenApi/
    // Embed don't — getTemplatesForType returns [] for those, see
    // EditorTemplates.ts). Once per cloudId+macro-type per browser — see
    // utils/starterGallery/autoOpenMarker.ts for why that's the scope
    // ("per user" proxy) instead of accountId. The marker is written BEFORE
    // opening, so it also covers "dismissing must never re-open in this or
    // a later session": the decision to auto-open is made at most once,
    // regardless of what the user does with the gallery afterward.
    const isNewMacro = !this.$store.state.diagram.id;
    if (isNewMacro && isBlankOrUntouchedSeed(this.diagramType, this.currentCode, this.$store.state.diagram.isNew) && getTemplatesForType(this.diagramType).length > 0) {
      const cloudId = getCachedCloudId() || 'unknown-cloud';
      if (!hasAutoOpenedStarterGallery(cloudId, this.diagramType)) {
        markStarterGalleryAutoOpened(cloudId, this.diagramType);
        this.openTemplateGallery("auto_first_open");
      }
    }

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

<style scoped>
/* Diagram-type tabs raised into a notch straddling the header's top edge,
   concave shoulders cut into the divider — see Claude Design
   preview/toolbar-header-notch.html. */
.notch {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  /* Hangs DOWN from the top of the header, 32px tall inside a 40px band so
     its bottom edge never reaches the work area below. border-top:0 keeps the
     top edge open; drawing one there leaves two floating stubs, because the
     side borders are still painted full height. */
  top: 0;
  height: 32px;
  display: flex;
  align-items: center;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-top: 0;
  border-radius: 0 0 12px 12px;
  padding: 0 6px;
  box-sizing: border-box;
}
</style>
