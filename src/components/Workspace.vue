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
            prototype-mode
            @close="closeAIChat"
            @toggle-code="toggleCodeEditor"
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
  import AIChatPanel from '@/components/AIChat/AIChatPanel.vue'
  import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

  export default {
    name: 'Workspace',
    props: {
      msg: String
    },
    data() {
      return {
        showAIChat: false,
        showCodeEditor: true,
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
    },
    methods: {
      toggleAIChat() {
        if (this.showAIChat) {
          this.closeAIChat()
          return
        }
        this.destroySplit()
        this.showAIChat = true
        this.showCodeEditor = false
        trackAnalyticsEvent('ai_chat_opened', {
          feature_area: 'ai',
          surface: 'editor',
          macro_type: this.diagramType || 'none',
          entry_point: 'ai_prompt',
        })
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
      initializeSplit() {
        if (!this.showCodeEditor) return
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

.ai-chat-panel-container {
  width: 368px;
  min-width: 340px;
  flex-shrink: 0;
  overflow: hidden;
  border-right: 1px solid #dfe1e6;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  z-index: 20;
}

.ai-chat-workspace-backdrop {
  display: none;
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

@media (max-width: 980px) {
  .ai-chat-panel-container {
    position: absolute;
    inset: 0 auto 0 0;
    width: min(368px, 94vw);
    min-width: 0;
  }

  .ai-chat-workspace-backdrop {
    position: absolute;
    inset: 0;
    z-index: 19;
    display: block;
    border: 0;
    background: rgba(0, 0, 0, 0.5);
  }
}
</style>
