<template>
  <aside
    v-if="open"
    class="flex h-full w-full flex-col bg-white"
    aria-label="AI diagram assistant"
    data-testid="ai-chat-panel"
  >
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
      <div class="flex min-w-0 items-center gap-2.5">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
          <SparklesIcon class="h-4 w-4" />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h2 class="truncate text-sm font-semibold text-slate-900">AI diagram assistant</h2>
            <span
              v-if="prototypeMode"
              class="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
            >
              Preview
            </span>
          </div>
          <p class="truncate text-xs text-slate-500">{{ diagramTypeLabel }} diagram</p>
        </div>
      </div>
      <button
        type="button"
        class="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
        aria-label="Close AI chat"
        data-testid="ai-chat-close"
        @click="emit('close')"
      >
        <XMarkIcon class="h-5 w-5" />
      </button>
    </header>

    <div ref="messageList" class="min-h-0 flex-1 overflow-y-auto">
      <div
        v-if="messages.length === 0 && !isThinking"
        class="flex min-h-full flex-col justify-center px-5 py-8"
        data-testid="ai-chat-empty-state"
      >
        <div class="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-700">
          <ChatBubbleLeftRightIcon class="h-5 w-5" />
        </div>
        <h3 class="mt-4 text-center text-base font-semibold text-slate-900">
          What would you like to change?
        </h3>
        <p class="mx-auto mt-1.5 max-w-64 text-center text-sm leading-5 text-slate-500">
          Describe the outcome. AI will propose an update before changing your diagram.
        </p>

        <div class="mt-6 space-y-2">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Try a request</p>
          <button
            v-for="suggestion in suggestions"
            :key="suggestion.id"
            type="button"
            class="group flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 transition-all hover:border-violet-300 hover:bg-violet-50/50 hover:text-violet-800"
            @click="selectSuggestion(suggestion)"
          >
            <span>{{ suggestion.label }}</span>
            <ArrowUpRightIcon class="h-4 w-4 text-slate-300 transition-colors group-hover:text-violet-500" />
          </button>
        </div>
      </div>

      <div v-else class="space-y-5 px-4 py-5" data-testid="ai-chat-conversation">
        <div
          v-for="message in messages"
          :key="message.id"
          class="flex"
          :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            v-if="message.role === 'assistant'"
            class="mr-2 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"
          >
            <SparklesIcon class="h-3.5 w-3.5" />
          </div>

          <div
            class="max-w-[86%] text-sm leading-5"
            :class="
              message.role === 'user'
                ? 'rounded-2xl rounded-br-md bg-slate-900 px-3.5 py-2.5 text-white'
                : 'text-slate-700'
            "
          >
            <p>{{ message.text }}</p>

            <div
              v-if="message.preview"
              class="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              data-testid="ai-change-preview"
            >
              <div class="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
                <div class="flex items-center gap-2">
                  <DocumentCheckIcon class="h-4 w-4 text-emerald-600" />
                  <span class="text-xs font-semibold text-slate-900">{{ message.preview.title }}</span>
                </div>
                <span class="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  Backend pending
                </span>
              </div>
              <ul class="space-y-2 px-3 py-3 text-xs text-slate-600">
                <li
                  v-for="item in message.preview.items"
                  :key="item"
                  class="flex items-start gap-2"
                >
                  <CheckIcon class="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span>{{ item }}</span>
                </li>
              </ul>
              <div class="flex gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2.5">
                <button
                  type="button"
                  class="flex-1 rounded-md bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  :disabled="prototypeMode"
                  :title="prototypeMode ? 'AI integration will enable this action' : undefined"
                  @click="applyChange(message)"
                >
                  Apply changes
                </button>
                <button
                  type="button"
                  class="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  @click="focusInput"
                >
                  Refine
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="isThinking" class="flex items-start" data-testid="ai-chat-thinking">
          <div class="mr-2 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
            <SparklesIcon class="h-3.5 w-3.5" />
          </div>
          <div class="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-500 shadow-sm">
            <span>Planning the change</span>
            <span class="ml-1 inline-flex gap-0.5" aria-hidden="true">
              <span class="ai-chat-dot">.</span>
              <span class="ai-chat-dot">.</span>
              <span class="ai-chat-dot">.</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <form class="shrink-0 border-t border-slate-200 bg-slate-50/80 p-3" @submit.prevent="submitPrompt">
      <div
        class="rounded-xl border border-slate-300 bg-white p-2 shadow-sm transition focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100"
      >
        <textarea
          ref="input"
          v-model="prompt"
          rows="3"
          class="block max-h-32 min-h-16 w-full resize-none border-0 bg-transparent px-1.5 py-1 text-sm leading-5 text-slate-800 outline-none placeholder:text-slate-400"
          placeholder="Describe how you want to change the diagram..."
          aria-label="AI change request"
          data-testid="ai-chat-input"
          :disabled="isThinking"
          @keydown.enter.exact.prevent="submitPrompt"
        />
        <div class="mt-1 flex items-center justify-between gap-2 px-1">
          <span class="text-[11px] text-slate-400">Enter to send · Shift+Enter for new line</span>
          <button
            type="submit"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-all hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            aria-label="Send message"
            data-testid="ai-chat-send"
            :disabled="!canSubmit"
          >
            <PaperAirplaneIcon class="h-4 w-4" />
          </button>
        </div>
      </div>
      <p v-if="prototypeMode" class="mt-2 text-center text-[10px] text-slate-400">
        UI preview only. No diagram code will be changed.
      </p>
    </form>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ArrowUpRightIconRender from '@heroicons/vue/24/outline/ArrowUpRightIcon'
import ChatBubbleLeftRightIconRender from '@heroicons/vue/24/outline/ChatBubbleLeftRightIcon'
import CheckIconRender from '@heroicons/vue/24/outline/CheckIcon'
import DocumentCheckIconRender from '@heroicons/vue/24/outline/DocumentCheckIcon'
import PaperAirplaneIconRender from '@heroicons/vue/24/outline/PaperAirplaneIcon'
import SparklesIconRender from '@heroicons/vue/24/outline/SparklesIcon'
import XMarkIconRender from '@heroicons/vue/24/outline/XMarkIcon'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { MacroTypeValue } from '@/utils/analytics/catalog'

const ArrowUpRightIcon = { render: ArrowUpRightIconRender }
const ChatBubbleLeftRightIcon = { render: ChatBubbleLeftRightIconRender }
const CheckIcon = { render: CheckIconRender }
const DocumentCheckIcon = { render: DocumentCheckIconRender }
const PaperAirplaneIcon = { render: PaperAirplaneIconRender }
const SparklesIcon = { render: SparklesIconRender }
const XMarkIcon = { render: XMarkIconRender }

type Suggestion = {
  id: string
  label: string
}

type ChangePreview = {
  title: string
  items: string[]
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  preview?: ChangePreview
}

type Props = {
  open: boolean
  diagramType?: string
  prototypeMode?: boolean
  initialMessages?: ChatMessage[]
}

const props = withDefaults(defineProps<Props>(), {
  diagramType: 'sequence',
  prototypeMode: false,
  initialMessages: () => [],
})

const emit = defineEmits<{
  close: []
  send: [prompt: string]
  apply: [message: ChatMessage]
}>()

const suggestions: Suggestion[] = [
  { id: 'add-error-path', label: 'Add an error handling path' },
  { id: 'simplify-flow', label: 'Simplify the main flow' },
  { id: 'highlight-steps', label: 'Highlight the key steps' },
]

const prompt = ref('')
const input = ref<HTMLTextAreaElement | null>(null)
const messageList = ref<HTMLElement | null>(null)
const messages = ref<ChatMessage[]>(props.initialMessages.map((message) => ({ ...message })))
const isThinking = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | undefined

const diagramTypeLabel = computed(() => {
  const labels: Record<string, string> = {
    sequence: 'Sequence',
    mermaid: 'Mermaid',
    plantuml: 'PlantUML',
    graph: 'Graph',
    openapi: 'OpenAPI',
  }
  return labels[props.diagramType.toLowerCase()] || 'Current'
})

const macroType = computed<MacroTypeValue>(() => {
  const value = props.diagramType.toLowerCase()
  const supported: MacroTypeValue[] = ['sequence', 'mermaid', 'graph', 'openapi', 'embed', 'plantuml']
  return supported.includes(value as MacroTypeValue) ? (value as MacroTypeValue) : 'none'
})

const canSubmit = computed(() => prompt.value.trim().length > 0 && !isThinking.value)

function selectSuggestion(suggestion: Suggestion) {
  prompt.value = suggestion.label
  trackAnalyticsEvent('ai_chat_suggestion_selected', {
    feature_area: 'ai',
    surface: 'editor',
    macro_type: macroType.value,
    suggestion_id: suggestion.id,
  })
  focusInput()
}

function focusInput() {
  nextTick(() => {
    input.value?.focus()
  })
}

function submitPrompt() {
  const text = prompt.value.trim()
  if (!text || isThinking.value) return

  messages.value.push({
    id: `user-${Date.now()}`,
    role: 'user',
    text,
  })
  prompt.value = ''

  trackAnalyticsEvent('ai_chat_prompt_submitted', {
    feature_area: 'ai',
    surface: 'editor',
    macro_type: macroType.value,
    generation_source: 'chat_panel',
    prompt_length: text.length,
    chat_message_count: messages.value.length,
  })
  emit('send', text)

  if (props.prototypeMode) {
    isThinking.value = true
    previewTimer = setTimeout(() => {
      messages.value.push({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: 'The conversation flow is ready. Once the AI service is connected, the proposed update will appear here for review.',
        preview: {
          title: 'Proposed update',
          items: [
            `Keep the current ${diagramTypeLabel.value} format`,
            'Preserve the existing diagram content',
            'Show a review step before applying changes',
          ],
        },
      })
      isThinking.value = false
    }, 700)
  }
}

function applyChange(message: ChatMessage) {
  trackAnalyticsEvent('ai_chat_change_applied', {
    feature_area: 'ai',
    surface: 'editor',
    macro_type: macroType.value,
    chat_message_count: messages.value.length,
  })
  emit('apply', message)
}

async function scrollToBottom() {
  await nextTick()
  if (messageList.value) {
    messageList.value.scrollTop = messageList.value.scrollHeight
  }
}

watch([messages, isThinking], scrollToBottom, { deep: true })

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer)
})
</script>

<style scoped>
.ai-chat-dot {
  animation: ai-chat-pulse 1.2s infinite;
}

.ai-chat-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.ai-chat-dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes ai-chat-pulse {
  0%,
  60%,
  100% {
    opacity: 0.25;
  }
  30% {
    opacity: 1;
  }
}
</style>
