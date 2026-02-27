<template>
  <header class="toolbar header border-b border-gray-200 px-6 py-3 flex items-center gap-3 relative z-10 h-14">
    <div class="flex items-center gap-3 flex-1 min-w-0">
      <TabSwitcher
        v-model="diagramType"
        :options="diagramOptions"
      />
      <div class="relative flex items-center flex-1 min-w-64">
        <input
          type="text"
          placeholder="Title"
          :value="currentTitle"
          @input="handleTitleChange"
          class="w-full px-3 py-2 border-2 border-gray-200 rounded-md focus:border-blue-500 hover:border-gray-300 outline-none transition-colors duration-200 h-10"
          :class="{ 'border-red-400 focus:border-red-400 bg-red-50': titleError, 'pr-10': isAiTitleEnabled }" />
        <div v-if="isAiTitleEnabled"
          class="absolute right-0 flex items-center">
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
      <a class="inline-block help"
        target="_blank"
        :href="templateUrl">
        <button class="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors duration-200"
          @click="templateClick">
          <LightBulbIcon class="w-4 h-4" />
          <span>Examples</span>
        </button>
      </a>
      <a class="inline-block help"
        target="_blank"
        :href="helpUrl">
        <button class="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors duration-200"
          @click="helpClick">
          <QuestionMarkCircleIcon class="w-4 h-4" />
          <span>Help</span>
        </button>
      </a>
      <div class="h-6 w-px bg-gray-300"></div>
      <div class="relative group/save">
        <publish-button
          :saveAndExit="saveAndExit"
          :disabled="isPublishDisabled" />
        <div class="absolute top-full right-0 pt-2 hidden transition-opacity duration-200"
          :class="isPublishDisabled ? 'group-hover/save:block' : ''">
          <div class="shadow-xl p-4 bg-white text-gray-700 text-sm rounded-lg ring-1 ring-gray-900/10 w-96">
            Please provide a clear and descriptive title to improve clarity,
            facilitate navigation and search on the dashboard, and enhance team
            communication.
          </div>
        </div>
      </div>
      <close-button
        :exit="exit" />
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
import CloseButton from "@/components/CloseButton.vue";
import TabSwitcher from "@/components/TabSwitcher/TabSwitcher.vue";
import { DiagramType } from "@/model/Diagram/Diagram";
import { getEditorDiagramOptions, getDiagramConfig, getCodeFromDiagram } from "@/model/Diagram/DiagramTypeConfig";
import EventBus from "@/EventBus";
import { trackEvent } from "@/utils/window";
import { getEditJourneyId, getOrCreateSession } from "@/utils/journeyTracking";
import Modal from "@/components/Modal/Modal.vue";
import { toast } from "@/utils/toast";
import aiGenerateTitle from "@/apis/aiGenerateTitle";
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
    CloseButton,
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
    templateClick() {
      trackEvent("template", "click", this.diagramType);
    },
    helpClick() {
      trackEvent("help", "click", this.diagramType);
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

    // this.aiTitleFeatureEnabled = await getFeatureFlags(['AI_TITLE']).then(res => res.AI_TITLE.enabled);
    this.aiTitleFeatureEnabled = false; // Disable the AI title feature as it is not ready
  },
};
</script>
