<template>
  <div class="absolute top-0 left-0" style="z-index: 999">
    <div>
      <GenerationPrompt :onConfirm="handleGenerate"/>
    </div>
  </div>

  <div class="content h-screen flex flex-col">
    <Notice />
    <Header class="flex-shrink-0"/>
    <div class="workspace flex-grow split">
      <div id="workspace-left" class="editor overflow-auto">
        <editor/>
      </div>
      <div id="workspace-right" class="diagram overflow-auto">
        <DiagramPortal />
      </div>
    </div>
    <CSAT />
    <AIFeedback />
  </div>
</template>

<script lang="ts">
  import Editor from '@/components/Editor/Editor.vue'
  import Split from 'split.js'
  import Header from "@/components/Header/Header.vue";
  import DiagramPortal from "@/components/DiagramPortal.vue";
  import CSAT from '@/components/CSAT/index.vue'
  import AIFeedback from '@/components/AIFeedback/index.vue'
  import Notice from '@/components/Notice/index.vue'
  import GenerationPrompt from "@/components/Editor/GenerationPrompt.vue";
  import {generateDiagramFromPage} from "@/services/GenerateService";
  import Example from "@/utils/sequence/Example";
  import store from '@/model/store2'
  import type {DiagramType} from "@/model/Diagram/Diagram";
  import getFeatureFlags from '@/apis/featureFlags';
  import globals from "@/model/globals";
  import {trackEvent} from '@/utils/window';

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
        Split(['#workspace-left', '#workspace-right'])
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
      Notice,
      GenerationPrompt,
      AIFeedback
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
  background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAeCAYAAADkftS9AAAAIklEQVQoU2M4c+bMfxAGAgYYmwGrIIiDjrELjpo5aiZeMwF+yNnOs5KSvgAAAABJRU5ErkJggg==');
  cursor: col-resize;
}
</style>
