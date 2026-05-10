<template>
  <header class="toolbar header border-b border-gray-200 px-6 py-3 flex items-center gap-3 relative z-10 h-14">
    <div class="flex items-center gap-3 flex-1 min-w-0">
      <TabSwitcher
        v-model="diagramType"
        :options="diagramOptions"
      />
      <div class="flex items-center flex-1 min-w-64 border-2 rounded-md transition-colors duration-200 h-10"
        :class="titleError ? 'border-red-400 bg-red-50' : 'border-gray-200 hover:border-gray-300 focus-within:border-blue-500'">
        <span class="pl-3 pr-2 text-xs font-semibold tracking-wide text-gray-400 uppercase select-none flex-shrink-0">Title</span>
        <div class="w-px h-4 bg-gray-200 flex-shrink-0"></div>
        <input
          type="text"
          placeholder="Name your diagram…"
          :value="currentTitle"
          @input="handleTitleChange"
          class="flex-1 px-2 py-2 bg-transparent outline-none text-sm min-w-0"
          :class="[titleError ? 'text-red-700 placeholder-red-300' : '', { 'pr-8': isAiTitleEnabled }]" />
        <div v-if="isAiTitleEnabled" class="pr-1 flex items-center">
          <button class="rounded-md p-1 text-gray-600 hover:bg-gray-200 transition-colors duration-200"
            :class="{ 'pointer-events-none opacity-50 cursor-not-allowed': titleLoading }"
            title="Generate title with AI"
            @click="handleGenerateTitle"
            :disabled="titleLoading">
            <SparklesIcon v-if="!titleLoading" class="w-5 h-5" />
            <ArrowPathIcon v-else class="w-5 h-5 animate-spin" />
          </button>
        </div>
      </div>
    </div>
    <div class="flex items-center gap-3 shrink-0">
      <button class="flex items-center gap-1.5 px-2.5 py-1.5 text-gray-500 text-sm font-medium rounded-md hover:text-gray-700 hover:bg-gray-100 transition-colors duration-200"
        @click="templateClick">
        <LightBulbIcon class="w-4 h-4" />
        <span>Examples</span>
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
          :disabled="isPublishDisabled" />
        <div class="absolute top-full right-0 pt-2 pointer-events-none opacity-0 transition-opacity duration-150"
          :class="isPublishDisabled ? 'group-hover/save:opacity-100' : ''">
          <div class="shadow-lg px-3 py-2 bg-gray-900 text-white text-xs rounded-md whitespace-nowrap">
            Add a diagram title to publish
          </div>
        </div>
      </div>
    </div>
    <Modal :visible="noticeModalVisible"
      :onConfirm="generateTitle"
      :onCancel="handleCloseModal">
      <template v-slot:body>
        <p>
          This is an experimental feature, and your data will be sent to
          Cloudflare. Cloudflare will not use your data as training data.
        </p>
      </template>
    </Modal>
  </header>
</template>

<script>
import { mapState, mapMutations } from "vuex";
import PublishButton from "@/components/PublishButton.vue";
import TabSwitcher from "@/components/TabSwitcher/TabSwitcher.vue";
import { setupCloseGuard } from "@/utils/closeGuard";
import { makeDebouncedDraftSaver, loadDraft, clearDraft, primeCloudId, getCachedCloudId, saveDraftSync } from "@/utils/draftStore";
import { DiagramType } from "@/model/Diagram/Diagram";
import { getEditorDiagramOptions, getDiagramConfig, getCodeFromDiagram, getStoreUpdateAction } from "@/model/Diagram/DiagramTypeConfig";
import EventBus from "@/EventBus";
import { trackEvent } from "@/utils/window";
import { getEditJourneyId, getOrCreateSession } from "@/utils/journeyTracking";
import Modal from "@/components/Modal/Modal.vue";
import { toast } from "@/utils/toast";
import aiGenerateTitle from "@/apis/aiGenerateTitle";
import { openUrl } from "@/model/globals/forgeGlobal";
import LightBulbIcon from '@heroicons/vue/24/outline/LightBulbIcon';
import QuestionMarkCircleIcon from '@heroicons/vue/24/outline/QuestionMarkCircleIcon';
import SparklesIcon from '@heroicons/vue/24/outline/SparklesIcon';
import ArrowPathIcon from '@heroicons/vue/24/outline/ArrowPathIcon';

function getMermaidType(dsl) {
  let type = dsl.trim().split("\n")[0].split(" ")[0];
  const typeMap = {
    graph: "flow chart",
    sequenceDiagram: "sequence",
    gantt: "gantt chart",
    classDiagram: "class",
    gitGraph: "git",
    erDiagram: "entity relationship",
    journey: "journey",
    quadrantChart: "quadrant chart",
    'xychart-beta': "xy chart",
  }
  return typeMap[type] || type
}

export default {
  name: "Header",
  components: {
    PublishButton,
    TabSwitcher,
    Modal,
    LightBulbIcon: { render: LightBulbIcon },
    QuestionMarkCircleIcon: { render: QuestionMarkCircleIcon },
    SparklesIcon: { render: SparklesIcon },
    ArrowPathIcon: { render: ArrowPathIcon },
  },
  data() {
    return {
      helpUrl: "https://zenuml.com/docs?utm_source=confluence-plugin&utm_medium=help-button&utm_campaign=confluence-plugin",
      titleError: false,
      titleLoading: false,
      noticeModalVisible: false,
      aiTitleFeatureEnabled: false,
      originalCode: "",
      diagramOptions: getEditorDiagramOptions()
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
    ...mapState({
      templateUrl: (state) =>
        getDiagramConfig(state.diagram.diagramType)?.templateUrl || '',
      title: (state) => state.diagram.title,
    }),
    currentCode() {
      return getCodeFromDiagram(this.$store.state.diagram, this.diagramType);
    },
    saveAndExit: function () {
      return () => {
        if (!this.$store.state.diagram.title) {
          return (this.titleError = true);
        }
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
    isAiTitleEnabled: function () {
      return this.aiTitleFeatureEnabled;
    },
    currentTitle: function () {
      return this.$store.state.diagram.title;
    },
    isPublishDisabled: function () {
      return !this.$store.state.diagram.title || this.titleError;
    },
  },
  watch: {
    diagramType: function () {
      // Clear title error when switching tabs - let isPublishDisabled compute the correct state
      this.titleError = false;
    },
  },
  methods: {
    ...mapMutations(["updateDiagramType"]),
    async templateClick() {
      trackEvent("template", "click", this.diagramType);
      if (this.templateUrl) {
        await openUrl(this.templateUrl);
      }
    },
    async helpClick() {
      trackEvent("help", "click", this.diagramType);
      await openUrl(this.helpUrl);
    },
    handleTitleChange(value) {
      if (value) {
        this.titleError = false;
      }
      this.$store.dispatch("updateTitle", value.target.value);
    },
    handleGenerateTitle() {
      this.noticeModalVisible = true;
    },
    handleCloseModal() {
      this.noticeModalVisible = false;
    },
    async generateTitle() {
      this.noticeModalVisible = false;
      this.titleLoading = true;
      const res = await aiGenerateTitle({
        dsl: this.currentCode,
        type:
          this.diagramType === DiagramType.Mermaid
            ? getMermaidType(this.currentCode)
            : DiagramType.Sequence,
      }).catch((e) => {
        this.titleLoading = false;
        toast({ message: e.message, duration: 3000 });
      });
      if (!res.ok) {
        this.titleLoading = false;
        toast({ message: await res.text(), duration: 3000 });
        return;
      }
      this.titleLoading = false;
      const generatedTitle = await res.text();
      this.$store.dispatch("updateTitle", generatedTitle);
    },
  },
  async mounted() {
    // Load user's preferred diagram type from localStorage for new diagrams
    const isNewDiagram = this.$store.state.diagram.isNew;
    if (isNewDiagram) {
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
      const updatedAt = Number(this.$store.state.diagram.updatedAt) || 0;
      if (draft.savedAt > updatedAt && (draft.code !== this.originalCode || draft.title !== this.$store.state.diagram.title)) {
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

    // Clear draft on successful publish.
    this._onPublished = () => clearDraft(this._draftScope);
    EventBus.$on('saved', this._onPublished);

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

    // this.aiTitleFeatureEnabled = await getFeatureFlags(['AI_TITLE']).then(res => res.AI_TITLE.enabled);
    this.aiTitleFeatureEnabled = false; // Disable the AI title feature as it is not ready
  },
  beforeUnmount() {
    this._closeGuardOff?.();
    this._draftSaver?.flush();
    this._unwatchDraft?.();
    if (this._onPublished) EventBus.$off('saved', this._onPublished);
    if (this._onRestore) EventBus.$off('draft-restore', this._onRestore);
  },
};
</script>
