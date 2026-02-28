<template>
  <div class="workspace-container">
    <div class="absolute top-0 left-0" style="z-index: 999" v-show="isNewDiagram && isAiTitleFeatureEnabled && isLite">
      <div>
        <GenerationPrompt :onConfirm="handleGenerate"/>
      </div>
    </div>

    <div class="content h-screen flex flex-col" style="height: 100vh; overflow: hidden;">
      <div class="flex-shrink-0">
        <Header />
      </div>
      <div class="workspace flex-grow split" style="overflow: hidden; position: relative;">
        <div id="workspace-left" class="editor flex flex-col flex-grow" style="overflow: hidden;">
          <div class="flex-grow overflow-auto" style="min-height: 0;">
            <editor/>
          </div>
        </div>
        <div id="workspace-right" class="diagram overflow-auto" style="overflow: auto;">
          <DiagramPortal />
        </div>
      </div>
      <div id="syntax-error-box" class="sticky bottom-0 left-0 right-0 z-[1000] bg-white flex-shrink-0" style="position: sticky !important;">
        <SyntaxErrorBox />
      </div>
      <div class="feedback-section flex-shrink-0">
        <CSAT variant="bar" />
        <AIFeedback />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
  import Editor from '@/components/Editor/Editor.vue'
  import Split from 'split.js'
  import Header from "@/components/Header/Header.vue";
  import DiagramPortal from "@/components/DiagramPortal.vue";
  import CSAT from '@/components/CSAT/index.vue'
  import AIFeedback from '@/components/AIFeedback/index.vue'
  import GenerationPrompt from "@/components/Editor/GenerationPrompt.vue";
  import {generateDiagramFromPage} from "@/services/GenerateService";
  import Example from "@/utils/sequence/Example";
  import store from '@/model/store2'
  import type {DiagramType} from "@/model/Diagram/Diagram";
  import getFeatureFlags from '@/apis/featureFlags';
  import globals from "@/model/globals";
  import {trackEvent} from '@/utils/window';
  import SyntaxErrorBox from '@/components/SyntaxErrorBox.vue'

  export default {
    name: 'Workspace',
    props: {
      msg: String
    },
    data() {
      return {
        aiTitleFeatureEnabled: false,
        isLite: false
      };
    },
    async mounted () {
      // @ts-ignore
      if (window.split) {
        Split(['#workspace-left', '#workspace-right'], { sizes: [35, 65] })
      }

      this.aiTitleFeatureEnabled = await getFeatureFlags(['AI_TITLE']).then((res: any) => res.AI_TITLE.enabled);
      this.isLite = globals.apWrapper.isLite();
    },
    computed: {
      isNewDiagram() {
        return this.$store.state.diagram.isNew;
      },
      isAiTitleFeatureEnabled() {
        return this.aiTitleFeatureEnabled;
      }
    },
    methods: {
      async handleGenerate(diagramType: DiagramType, userPrompt: string) {
        if(diagramType) {
          await generateDiagramFromPage(diagramType, userPrompt);

          trackEvent('generate_diagram_from_page', 'click_generate_button', diagramType, {userPromptLength: userPrompt.length});
        } else {
          store.dispatch('updateCode2', Example.Sequence);
          trackEvent('generate_diagram_from_page', 'click_open_editor_button', '');
        }
      },
    },
    components: {
      DiagramPortal,
      Header,
      Editor,
      CSAT,
      GenerationPrompt,
      AIFeedback,
      SyntaxErrorBox
    }
  }
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style>
.split {
  display: flex;
  flex-direction: row;
}

.gutter {
  background-color: #eee;
  background-repeat: no-repeat;
  background-position: 50%;
}

.gutter.gutter-horizontal {
  cursor: col-resize;
  background-color: #e5e7eb;
  transition: background-color 0.15s ease;
  position: relative;
  width: 6px !important;
}

.gutter.gutter-horizontal:hover {
  background-color: #9ca3af;
}

/* Handle bar centred in the gutter */
.gutter.gutter-horizontal::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 3px;
  height: 32px;
  border-radius: 2px;
  background-color: #d1d5db;
  transition: background-color 0.15s ease;
}

.gutter.gutter-horizontal:hover::after {
  background-color: #6b7280;
}
</style>
