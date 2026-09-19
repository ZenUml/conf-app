<template>
  <div class="workspace-container">
    <div class="content h-screen flex flex-col" style="height: 100vh; overflow: hidden;">
      <div class="flex-shrink-0">
        <Header
          :ai-chat-open="showAIChat"
          :code-panel-visible="showCodeEditor"
          @toggle-ai-chat="toggleAIChat"
          @toggle-code-panel="toggleCodePanel('header_button')"
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
            <!-- The pane's own collapse control. The header button is at the
                 far top-right, a whole editor away from where the eyes are
                 while typing; this one sits where the pane ends. Hidden while
                 AI chat is open, for the same reason the header button is:
                 that panel owns this pane's visibility then, through its own
                 toggle and its own event. -->
            <div
              v-if="!showAIChat"
              class="code-panel-footer flex flex-shrink-0 items-center border-t border-gray-200 bg-[#F1F3F4] px-1"
            >
              <button
                type="button"
                class="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-gray-500 transition-colors duration-200 hover:bg-gray-200 hover:text-gray-700"
                aria-label="Hide code panel"
                title="Hide the code panel and give the diagram the full width"
                data-testid="code-panel-collapse"
                @click="collapseCodePanel('panel_footer')"
              >
                <ChevronDoubleLeftIcon class="h-3.5 w-3.5" />
                <span>Hide</span>
              </button>
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
  import ChevronDoubleLeftIcon from '@heroicons/vue/24/outline/ChevronDoubleLeftIcon'
  import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
  import type { CodePanelToggleTrigger } from '@/utils/analytics/catalog'
  import { DiagramType } from '@/model/Diagram/Diagram'
  import { getCodeFromDiagram, getStoreUpdateAction } from '@/model/Diagram/DiagramTypeConfig'

  // split.js reports pane sizes as percentages of the workspace width.
  //
  // A drag that ends with the code pane this narrow is a drag meant to close
  // it: what is left is a few unreadable columns plus a gutter with nothing
  // behind it, and the header button would still read "Hide code".
  const CODE_PANEL_COLLAPSE_AT_PERCENT = 6
  // A pane narrower than this is never remembered as the width to restore to
  // — reopening into a sliver looks broken. The gap between the two numbers
  // is deliberate: a pane dragged to 7-9% stays exactly where it was put,
  // but reopening after a collapse returns to the last width worth having.
  const MIN_RESTORABLE_CODE_PANEL_PERCENT = 10
  // How close to the left edge (in px) the gutter has to get before split.js
  // snaps the pane to its 0 minimum. Generous on purpose: this is the whole
  // "drag it away" gesture, and the pane is closed for real on drag end.
  const CODE_PANEL_SNAP_OFFSET_PX = 60
  // The diagram keeps a usable width wherever the gutter is dropped. Only the
  // code pane collapses; there is no symmetric "hide the diagram".
  const MIN_DIAGRAM_PANEL_PX = 200

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
        aiChatOpenedAt: 0,
        splitInstance: null as ReturnType<typeof Split> | null,
        // Last pane split the user actually had, so collapsing the code panel
        // (or opening AI chat, which also tears the split down) and coming back
        // restores their width instead of snapping to the 35/65 default.
        splitSizes: [35, 65] as number[],
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
    watch: {
      diagramType(type) {
        if (type === DiagramType.Markdown && this.showAIChat) this.closeAIChat();
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
        this.aiChatOpenedAt = Date.now()
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
          session_duration_ms: this.aiChatOpenedAt
            ? Math.max(0, Date.now() - this.aiChatOpenedAt)
            : 0,
          close_reason: 'user_closed',
        })
        this.aiChatOpenedAt = 0
      },
      toggleCodeEditor() {
        this.showCodeEditor = !this.showCodeEditor
        if (this.showCodeEditor) {
          this.initializeSplit()
          return
        }
        this.destroySplit()
      },
      // Every deliberate show/hide of the code pane funnels through here —
      // the header's Code button, the pane's footer button, and a gutter
      // dragged shut. Same pane as AI chat's "Hide code" toggle, but its own
      // event: this one is about giving the preview the full width while
      // authoring, not about what AI chat needs on screen.
      toggleCodePanel(trigger: CodePanelToggleTrigger) {
        this.toggleCodeEditor()
        trackAnalyticsEvent('editor_code_panel_toggled', {
          feature_area: 'macro',
          surface: 'editor',
          macro_type: this.diagramType || 'none',
          interaction_state: this.showCodeEditor ? 'shown' : 'hidden',
          code_panel_trigger: trigger,
        })
      },
      collapseCodePanel(trigger: CodePanelToggleTrigger) {
        if (!this.showCodeEditor) return
        this.toggleCodePanel(trigger)
      },
      // split.js has already snapped the pane to zero width by the time this
      // runs (minSize 0 + snapOffset below); closing it here is what turns
      // that into a real collapsed state rather than an invisible pane still
      // holding a gutter.
      onSplitDragEnd(sizes: number[]) {
        if (!Array.isArray(sizes) || sizes.length !== 2) return
        if (sizes[0] <= CODE_PANEL_COLLAPSE_AT_PERCENT) {
          this.collapseCodePanel('gutter_drag')
          return
        }
        this.rememberSplitSizes(sizes)
      },
      applyAIChatCode(code: string) {
        const action = getStoreUpdateAction(this.diagramType)
        if (!action) return

        // The error belongs to the code being replaced. Clear it synchronously
        // so AI Chat cannot offer a repair for a stale validation result while
        // Editor.vue validates the new code in the background.
        this.$store.dispatch('updateError', null)
        this.$store.dispatch(action, code)
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
          this.splitInstance = Split(['#workspace-left', '#workspace-right'], {
            sizes: this.splitSizes,
            // 0 lets the code pane be dragged all the way shut; the diagram
            // keeps a floor so the gutter never ends up pinned to the right.
            minSize: [0, MIN_DIAGRAM_PANEL_PX],
            // Snapping only applies to the collapsible side.
            snapOffset: [CODE_PANEL_SNAP_OFFSET_PX, 0],
            onDragEnd: this.onSplitDragEnd,
          })
        })
      },
      destroySplit() {
        if (this.splitInstance) {
          // getSizes() is the only place the dragged widths live — split.js
          // strips the inline styles on destroy(), so read them first.
          this.rememberSplitSizes(this.splitInstance.getSizes?.())
        }
        this.splitInstance?.destroy()
        this.splitInstance = null
      },
      rememberSplitSizes(sizes: number[] | undefined) {
        if (!Array.isArray(sizes) || sizes.length !== 2) return
        if (!sizes.every(size => Number.isFinite(size))) return
        // A collapsed (or nearly collapsed) pane is a state, not a width:
        // remembering it would restore the panel into an unusable sliver.
        if (sizes[0] < MIN_RESTORABLE_CODE_PANEL_PERCENT || sizes[1] <= 0) return
        this.splitSizes = sizes
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
      ChevronDoubleLeftIcon,
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

/* The editor preview is a fixed-height flex pane. Keep the chrome-less viewer
   in that pane so svg-pan-zoom receives a real viewport height instead of the
   browser's 150px default for an SVG whose viewBox has been removed. */
#workspace-right > .generic {
  display: flex;
  flex-direction: column;
  height: 100%;
}

#workspace-right > .generic > .screen-capture-content {
  flex: 1 1 auto;
  min-height: 0;
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
