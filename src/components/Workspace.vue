<template>
  <div class="absolute top-0 left-0" style="z-index: 999" v-show="isNewDiagram">
    <GenerationPrompt :onConfirm="handleGenerate"/>
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
  </div>
</template>

<script>
  import Editor from '@/components/Editor/Editor.vue'
  import Split from 'split.js'
  import Header from "@/components/Header/Header.vue";
  import DiagramPortal from "@/components/DiagramPortal.vue";
  import CSAT from '@/components/CSAT/index.vue'
  import Notice from '@/components/Notice/index.vue'
  import GenerationPrompt from "@/components/Editor/GenerationPrompt.vue";
  import {generateDiagramFromPage} from "@/services/GenerateService";
  import Example from "@/utils/sequence/Example";
  import store from '@/model/store2'

  export default {
    name: 'Workspace',
    props: {
      msg: String
    },
    mounted () {
      if (window.split) {
        Split(['#workspace-left', '#workspace-right'])
      }
    },
    computed: {
      isNewDiagram() {
        return !store.state.diagram.code;
      }
    },
    methods: {
      async handleGenerate(value) {
        if(value) {
          console.log('Generate')
          await generateDiagramFromPage(value);
        } else {
          store.dispatch('updateCode2', Example.Sequence);
        }
      }
    },
    components: {
      DiagramPortal,
      Header,
      Editor,
      CSAT,
      Notice,
      GenerationPrompt
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
