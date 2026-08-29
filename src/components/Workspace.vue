<template>
  <div class="workspace-container">
    <div class="content h-screen flex flex-col" style="height: 100vh; overflow: hidden;">
      <div class="flex-shrink-0">
        <Header
          :ai-chat-open="showAIChat"
          @toggle-ai-chat="toggleAIChat"
        />
      </div>
      <div class="workspace flex-grow split" style="overflow: hidden; position: relative;">
        <div v-if="showAIChat" class="ai-chat-panel-container">
          <AIChatPanel
            :open="showAIChat"
            :code-visible="showCodeEditor"
            :diagram-type="diagramType"
            :syntax-error="syntaxError"
            :syntax-repair-request-id="syntaxRepairRequestId"
            :current-code="currentCode"
            :diagram-title="diagramTitle"
            :diagramly-diagram-id="diagramlyDiagramId"
            @close="closeAIChat"
            @toggle-code="toggleCodeEditor"
            @apply-code="applyAIChatCode"
            @diagramly-diagram-bound="bindDiagramlyDiagram"
          />
        </div>
        <button
          v-if="showAIChat"
          type="button"
          class="ai-chat-workspace-backdrop"
          aria-label="Close AI chat"
          data-testid="ai-chat-backdrop"
          @click="closeAIChat"
        />
        <div
          class="workspace-main flex min-w-0 flex-1 split"
          :class="{ 'code-editor-hidden': !showCodeEditor }"
        >
          <div
            v-show="showCodeEditor"
            id="workspace-left"
            class="editor flex flex-col flex-grow"
            style="overflow: hidden;"
          >
            <div class="flex-grow overflow-auto" style="min-height: 0;">
              <editor/>
            </div>
          </div>
          <div id="workspace-right" class="diagram min-w-0 overflow-auto" style="overflow: auto;">
            <DiagramPortal :hide-header="true" />
          </div>
        </div>
      </div>
      <div
        v-show="!showAIChat"
        id="syntax-error-box"
        class="sticky bottom-0 left-0 right-0 z-[1000] bg-white flex-shrink-0"
        style="position: sticky !important;"
      >
        <ForeignDialectHint />
        <SyntaxErrorBox @request-ai-chat-repair="requestAIChatSyntaxRepair" />
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
  import AIChatPanel from '@/components/AIChat/AIChatPanel.vue'
  import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
  import { DiagramType } from '@/model/Diagram/Diagram'
  import { getCodeFromDiagram, getStoreUpdateAction } from '@/model/Diagram/DiagramTypeConfig'

  export default {
    name: 'Workspace',
    props: {
      msg: String
    },
    data() {
      return {
        showAIChat: false,
        showCodeEditor: true,
        syntaxRepairRequestId: 0,
        splitInstance: null as ReturnType<typeof Split> | null,
      }
    },
    computed: {
      diagramType() {
        return this.$store.state.diagram.diagramType
      },
      syntaxError() {
        return this.$store.state.error?.toString() || ''
      },
      currentCode() {
        return getCodeFromDiagram(this.$store.state.diagram, this.diagramType)
      },
      diagramTitle() {
        return this.$store.state.diagram.title || ''
      },
      diagramlyDiagramId() {
        return this.$store.state.diagram.metadata?.aiChat?.diagramlyDiagramId || ''
      },
    },
    methods: {
      toggleAIChat() {
        if (this.showAIChat) {
          this.closeAIChat()
          return
        }
        this.openAIChat('ai_prompt')
      },
      openAIChat(entryPoint: 'ai_prompt' | 'ai_repair') {
        if (this.diagramType === DiagramType.Graph || this.showAIChat) return
        this.destroySplit()
        this.showAIChat = true
        this.showCodeEditor = false
        trackAnalyticsEvent('ai_chat_opened', {
          feature_area: 'ai',
          surface: 'editor',
          macro_type: this.diagramType || 'none',
          entry_point: entryPoint,
        })
      },
      requestAIChatSyntaxRepair() {
        if (this.diagramType === DiagramType.Graph) return
        this.openAIChat('ai_repair')
        this.syntaxRepairRequestId += 1
      },
      closeAIChat() {
        if (!this.showAIChat) return
        this.showAIChat = false
        this.showCodeEditor = true
        this.initializeSplit()
        trackAnalyticsEvent('ai_chat_closed', {
          feature_area: 'ai',
          surface: 'editor',
          macro_type: this.diagramType || 'none',
        })
      },
      toggleCodeEditor() {
        this.showCodeEditor = !this.showCodeEditor
        if (this.showCodeEditor) {
          this.initializeSplit()
          return
        }
        this.destroySplit()
      },
      applyAIChatCode(code: string) {
        const action = getStoreUpdateAction(this.diagramType)
        if (action) this.$store.dispatch(action, code)
      },
      bindDiagramlyDiagram(diagramId: string) {
        this.$store.dispatch('updateMetadata', {
          ...(this.$store.state.diagram.metadata || {}),
          aiChat: {
            ...(this.$store.state.diagram.metadata?.aiChat || {}),
            diagramlyDiagramId: diagramId,
          },
        })
      },
      initializeSplit() {
        if (!this.showCodeEditor || !(window as any).split) return
        this.$nextTick(() => {
          if (!document.querySelector('#workspace-left') || !document.querySelector('#workspace-right')) return
          this.destroySplit()
          this.splitInstance = Split(['#workspace-left', '#workspace-right'], { sizes: [35, 65] })
        })
      },
      destroySplit() {
        this.splitInstance?.destroy()
        this.splitInstance = null
      },
    },
    async mounted () {
      this.initializeSplit()
    },
    beforeUnmount() {
      this.destroySplit()
    },
    components: {
      DiagramPortal,
      Header,
      Editor,
      SyntaxErrorBox,
      ForeignDialectHint,
      AIChatPanel,
    }
  }
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style>
.split {
  display: flex;
  flex-direction: row;
}

.workspace-main {
  overflow: hidden;
}

.workspace-main.code-editor-hidden #workspace-right {
  width: 100% !important;
  flex: 1 1 auto;
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
