<template>
  <div class="workspace-container">
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
          <DiagramPortal :hide-header="true" />
        </div>
      </div>
      <div id="syntax-error-box" class="sticky bottom-0 left-0 right-0 z-[1000] bg-white flex-shrink-0" style="position: sticky !important;">
        <ArchitectureTokenBindingStatus />
        <ArchitectureTokenBindingActions />
        <ForeignDialectHint />
        <SyntaxErrorBox />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
  import Editor from '@/components/Editor/Editor.vue'
  import Split from 'split.js'
  import Header from "@/components/Header/Header.vue";
  import DiagramPortal from "@/components/DiagramPortal.vue";
  import SyntaxErrorBox from '@/components/SyntaxErrorBox.vue'
  import ForeignDialectHint from '@/components/ForeignDialectHint.vue'
  import ArchitectureTokenBindingStatus from '@/components/ArchitectureTokens/ArchitectureTokenBindingStatus.vue'
  import ArchitectureTokenBindingActions from '@/components/ArchitectureTokens/ArchitectureTokenBindingActions.vue'

  export default {
    name: 'Workspace',
    props: {
      msg: String
    },
    async mounted () {
      // @ts-ignore
      if (window.split) {
        Split(['#workspace-left', '#workspace-right'], { sizes: [35, 65] })
      }
    },
    components: {
      DiagramPortal,
      Header,
      Editor,
      SyntaxErrorBox,
      ForeignDialectHint,
      ArchitectureTokenBindingStatus,
      ArchitectureTokenBindingActions
    }
  }
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style>
.split {
  display: flex;
  flex-direction: row;
}

#workspace-right {
  background-color: #f8f7f4;
  background-image: radial-gradient(circle, #d0cec7 1px, transparent 1px);
  background-size: 20px 20px;
  padding: 24px;
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
