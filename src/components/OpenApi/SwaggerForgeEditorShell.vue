<template>
  <div style="position: relative; height: 100vh; display: flex; flex-direction: column">
    <div style="flex-shrink: 0">
      <OpenApiHeader
        :save-and-exit="saveAndExit"
        :exit="exit"
        :ai-chat-open="showAIChat"
        :on-toggle-ai-chat="toggleAIChat"
      />
    </div>
    <div :class="['swagger-editor-workspace', { 'code-editor-hidden': !showCodeEditor }]">
      <div v-if="showAIChat" ref="aiChatHostRef" class="ai-chat-panel-container" />
      <button
        v-if="showAIChat"
        type="button"
        class="ai-chat-workspace-backdrop"
        aria-label="Close AI chat"
        data-testid="react-ai-chat-backdrop"
        @click="closeAIChat"
      />
      <div
        id="swagger-editor"
        style="flex: 1; min-width: 0; min-height: 0; overflow: auto"
      />
    </div>
    <div
      id="syntax-error-box"
      :style="{
        display: showAIChat ? 'none' : 'block',
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        backgroundColor: 'white',
        flexShrink: 0,
        fontSize: '14px',
      }"
    >
      <SyntaxErrorBox @request-ai-chat-repair="requestSyntaxRepair" />
    </div>
  </div>
</template>

<script setup lang="ts">
import React from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import OpenApiHeader from '@/components/OpenApi/OpenApiHeader.vue'
import SyntaxErrorBox from '@/components/SyntaxErrorBox.vue'
import AIChatPanel from '@/components/react/AIChatPanel'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import store from '@/model/store2'

const props = withDefaults(
  defineProps<{
    saveAndExit?: () => void
    exit?: () => void
    /** Runs SwaggerEditorBundle bootstrap + document hydration after #swagger-editor is in the DOM */
    onMountedBootstrap?: () => void | Promise<void>
  }>(),
  {
    saveAndExit: () => {},
    exit: () => {},
    onMountedBootstrap: undefined,
  },
)

const showAIChat = ref(false)
const showCodeEditor = ref(true)
const syntaxError = ref(store.state.error?.toString() || '')
const currentCode = ref(store.state.diagram.code || '')
const diagramlyDiagramId = ref(
  (store.state.diagram.metadata as any)?.aiChat?.diagramlyDiagramId || '',
)
const syntaxRepairRequestId = ref(0)
const aiChatHostRef = ref<HTMLElement | null>(null)

let aiChatOpenedAt = 0
let aiChatReactRoot: Root | null = null
let unsubscribeStore: (() => void) | null = null

function updateStore(mutation: string, payload: any) {
  if (typeof (store as any).commit === 'function') {
    store.commit(mutation, payload)
  } else if (typeof (store as any).dispatch === 'function') {
    void store.dispatch(mutation, payload)
  }
}

async function bindDiagramlyDiagram(diagramId: string) {
  updateStore('updateMetadata', {
    ...(store.state.diagram.metadata || {}),
    aiChat: {
      ...((store.state.diagram.metadata as any)?.aiChat || {}),
      diagramlyDiagramId: diagramId,
    },
  })
}

function toggleAIChat() {
  const next = !showAIChat.value
  showAIChat.value = next
  showCodeEditor.value = !next
  const sessionDurationMs = aiChatOpenedAt ? Math.max(0, Date.now() - aiChatOpenedAt) : 0
  if (next) aiChatOpenedAt = Date.now()
  trackAnalyticsEvent(next ? 'ai_chat_opened' : 'ai_chat_closed', {
    feature_area: 'ai',
    surface: 'editor',
    macro_type: 'openapi',
    ...(next ? { entry_point: 'ai_prompt' as const } : {}),
    ...(!next
      ? { session_duration_ms: sessionDurationMs, close_reason: 'user_closed' as const }
      : {}),
  })
  if (!next) aiChatOpenedAt = 0
}

function closeAIChat() {
  if (!showAIChat.value) return
  showAIChat.value = false
  showCodeEditor.value = true
  trackAnalyticsEvent('ai_chat_closed', {
    feature_area: 'ai',
    surface: 'editor',
    macro_type: 'openapi',
    session_duration_ms: aiChatOpenedAt ? Math.max(0, Date.now() - aiChatOpenedAt) : 0,
    close_reason: 'user_closed',
  })
  aiChatOpenedAt = 0
}

function requestSyntaxRepair() {
  if (!showAIChat.value) {
    aiChatOpenedAt = Date.now()
    trackAnalyticsEvent('ai_chat_opened', {
      feature_area: 'ai',
      surface: 'editor',
      macro_type: 'openapi',
      entry_point: 'ai_repair',
    })
  }
  showAIChat.value = true
  showCodeEditor.value = false
  syntaxRepairRequestId.value += 1
}

function renderReactAiChatPanel() {
  if (!showAIChat.value || !aiChatHostRef.value) {
    if (aiChatReactRoot) {
      aiChatReactRoot.unmount()
      aiChatReactRoot = null
    }
    return
  }
  if (!aiChatReactRoot) {
    aiChatReactRoot = createRoot(aiChatHostRef.value)
  }
  flushSync(() => {
    aiChatReactRoot?.render(
      React.createElement(AIChatPanel as any, {
        open: showAIChat.value,
        codeVisible: showCodeEditor.value,
        diagramType: 'openapi',
        syntaxError: syntaxError.value,
        syntaxRepairRequestId: syntaxRepairRequestId.value,
        currentCode: currentCode.value,
        diagramTitle: store.state.diagram.title || '',
        diagramlyDiagramId: diagramlyDiagramId.value,
        onClose: closeAIChat,
        onToggleCode: () => {
          showCodeEditor.value = !showCodeEditor.value
        },
        onApplyCode: (code: string) => updateStore('updateCode2', code),
        onDiagramlyDiagramBound: bindDiagramlyDiagram,
      }),
    )
  })
}

watch(
  [
    showAIChat,
    showCodeEditor,
    syntaxError,
    syntaxRepairRequestId,
    currentCode,
    diagramlyDiagramId,
    aiChatHostRef,
  ],
  async () => {
    await nextTick()
    renderReactAiChatPanel()
  },
  { flush: 'post' },
)

onMounted(() => {
  unsubscribeStore = store.subscribe((mutation, state) => {
    if (mutation.type === 'updateError') {
      syntaxError.value = state.error?.toString() || ''
    }
    currentCode.value = state.diagram.code || ''
    diagramlyDiagramId.value = (state.diagram.metadata as any)?.aiChat?.diagramlyDiagramId || ''
  })

  window.addEventListener('ai-chat-request-syntax-repair', requestSyntaxRepair)
  void props.onMountedBootstrap?.()
})

onBeforeUnmount(() => {
  window.removeEventListener('ai-chat-request-syntax-repair', requestSyntaxRepair)
  unsubscribeStore?.()
  if (aiChatReactRoot) {
    aiChatReactRoot.unmount()
    aiChatReactRoot = null
  }
})
</script>
