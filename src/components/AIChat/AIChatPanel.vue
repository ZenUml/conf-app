<template>
  <aside
    v-if="open"
    class="flex h-full w-full flex-col bg-white"
    aria-label="AI diagram assistant"
    data-testid="ai-chat-panel"
  >
    <header class="shrink-0 border-b border-slate-200 px-3.5 py-2.5">
      <div class="flex min-w-0 items-center gap-2" data-testid="ai-chat-header-row">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
            <SparklesIcon class="h-[18px] w-[18px]" />
          </div>
          <h2 class="truncate text-sm font-semibold text-slate-900">AI Assistant</h2>
          <button
            v-if="syntaxError"
            type="button"
            class="flex shrink-0 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-200"
            aria-label="Show syntax issue details"
            :aria-expanded="syntaxDetailsOpen"
            data-testid="ai-chat-syntax-indicator"
            @click="syntaxDetailsOpen = !syntaxDetailsOpen"
          >
            <ExclamationTriangleIcon class="h-3 w-3" />
            <span>Syntax</span>
          </button>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
            :aria-label="codeVisible ? 'Hide code editor' : 'Show code editor'"
            data-testid="ai-chat-code-toggle"
            @click="emit('toggle-code')"
          >
            <CodeBracketSquareIcon class="h-3.5 w-3.5" />
            <span>{{ codeVisible ? 'Hide' : 'Show' }}</span>
          </button>
          <button
            type="button"
            class="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
            aria-label="Close AI chat"
            data-testid="ai-chat-close"
            @click="emit('close')"
          >
            <XMarkIcon class="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        v-if="syntaxError && syntaxDetailsOpen"
        class="mt-2 rounded-lg border border-rose-100 bg-rose-50/70 px-2.5 py-2"
        data-testid="ai-chat-syntax-details"
      >
        <p class="break-words text-xs leading-4 text-rose-800">{{ syntaxErrorSummary }}</p>
      </div>
    </header>

    <div ref="messageList" class="min-h-0 flex-1 overflow-y-auto">
      <div
        v-if="messages.length === 0 && !isThinking"
        class="px-3.5 py-4"
        data-testid="ai-chat-empty-state"
      >
        <div class="rounded-xl bg-slate-50 px-3.5 py-3.5">
          <h3 class="text-base font-semibold text-slate-900">
            How should I update this diagram?
          </h3>
          <p class="mt-1.5 text-sm leading-5 text-slate-600">
            Describe the outcome. I will prepare the change and show you exactly what will be updated.
          </p>
          <div class="mt-3 flex items-start gap-2 text-xs leading-4 text-slate-500">
            <ShieldCheckIcon class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>Your diagram stays unchanged until you apply the proposal.</span>
          </div>
        </div>

        <div class="mt-4">
          <p class="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Common changes
          </p>
          <div class="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            <button
              v-for="suggestion in suggestions"
              :key="suggestion.id"
              type="button"
              class="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-violet-50/60 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-200"
              @click="selectSuggestion(suggestion)"
            >
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-slate-800 group-hover:text-violet-800">
                  {{ suggestion.label }}
                </p>
                <p class="mt-0.5 text-xs leading-4 text-slate-500">
                  {{ suggestion.description }}
                </p>
              </div>
              <ArrowRightIcon class="h-4 w-4 shrink-0 text-slate-300 group-hover:text-violet-500" />
            </button>
          </div>
        </div>
      </div>

      <div v-else class="space-y-4 px-3.5 py-4" data-testid="ai-chat-conversation">
        <div v-for="message in messages" :key="message.id">
          <div v-if="message.role === 'user'" class="rounded-lg bg-slate-50 px-3 py-2.5">
            <span class="text-[11px] font-semibold text-slate-500">You</span>
            <p class="text-sm leading-5 text-slate-800">{{ message.text }}</p>
          </div>

          <div v-else class="w-full">
            <div class="flex items-center gap-2">
              <div class="flex h-6 w-6 items-center justify-center rounded-md bg-violet-50 text-violet-700">
                <SparklesIcon class="h-3.5 w-3.5" />
              </div>
              <span class="text-xs font-semibold text-slate-700">AI Assistant</span>
            </div>
            <p class="mt-2 text-sm leading-5 text-slate-600">{{ message.text }}</p>

            <template v-if="message.preview">
              <div
                class="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-slate-500"
                data-testid="ai-chat-complete-status"
              >
                <span class="flex items-center gap-1 text-emerald-700">
                  <CheckCircleIcon class="h-3.5 w-3.5" />
                  Understood
                </span>
                <span aria-hidden="true">·</span>
                <span class="flex items-center gap-1 text-emerald-700">
                  <CheckCircleIcon class="h-3.5 w-3.5" />
                  Updated
                </span>
                <span aria-hidden="true">·</span>
                <span class="font-semibold text-violet-700">Ready to review</span>
              </div>

              <div
                class="mt-3 overflow-hidden rounded-xl border border-violet-200 bg-violet-50/50"
                data-testid="ai-change-preview"
              >
                <div class="flex items-center gap-2 border-b border-violet-100 px-3 py-2.5">
                  <DocumentCheckIcon class="h-[18px] w-[18px] text-violet-700" />
                  <span class="text-sm font-semibold text-violet-900">{{ message.preview.title }}</span>
                </div>
                <ul class="space-y-2 px-3 py-3 text-xs leading-4 text-slate-700">
                  <li
                    v-for="item in message.preview.items"
                    :key="item"
                    class="flex items-start gap-2"
                  >
                    <CheckCircleIcon class="mt-px h-4 w-4 shrink-0 text-violet-600" />
                    <span>{{ item }}</span>
                  </li>
                </ul>
                <div class="mx-3 flex items-start gap-2 border-t border-violet-100 py-2.5 text-[11px] leading-4 text-slate-500">
                  <ShieldCheckIcon class="mt-px h-4 w-4 shrink-0 text-slate-400" />
                  <span>Your current diagram stays unchanged until you click Apply.</span>
                </div>
                <div class="flex gap-2 bg-white/70 px-2.5 py-2.5">
                  <button
                    type="button"
                    class="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:ring-offset-1 disabled:cursor-not-allowed disabled:bg-violet-400"
                    :disabled="prototypeMode"
                    :title="prototypeMode ? 'Available when the AI service is connected' : undefined"
                    @click="applyChange(message)"
                  >
                    <span>Apply to diagram</span>
                    <SparklesIcon class="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    class="min-h-9 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-200"
                    @click="focusInput"
                  >
                    Refine
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>

        <div
          v-if="isThinking"
          class="w-full"
          role="status"
          aria-live="polite"
          data-testid="ai-chat-thinking"
        >
          <div class="flex items-center gap-2">
            <div class="flex h-6 w-6 items-center justify-center rounded-md bg-violet-50 text-violet-700">
              <SparklesIcon class="h-3.5 w-3.5" />
            </div>
            <span class="text-xs font-semibold text-slate-700">AI Assistant</span>
          </div>
          <ol class="ai-stage-list mt-3 ml-2.5 border-l border-slate-200 pl-5">
            <li class="ai-stage-item pb-3">
              <span class="ai-stage-marker bg-emerald-500 text-white">
                <CheckIcon class="h-3 w-3" />
              </span>
              <p class="text-xs font-semibold text-slate-800">Understanding request</p>
              <p class="mt-0.5 text-xs leading-4 text-slate-500">
                Reading the current {{ diagramTypeLabel }} diagram and your instruction.
              </p>
            </li>
            <li class="ai-stage-item pb-3">
              <span class="ai-stage-marker ai-stage-marker-active bg-violet-600 text-white">2</span>
              <p class="text-xs font-semibold text-violet-800">Updating diagram</p>
              <p class="mt-0.5 text-xs leading-4 text-slate-500">
                Building a safe proposal for you to review.
              </p>
            </li>
            <li class="ai-stage-item">
              <span class="ai-stage-marker border border-slate-200 bg-white text-slate-400">3</span>
              <p class="text-xs font-medium text-slate-400">Preparing preview</p>
            </li>
          </ol>
        </div>
      </div>
    </div>

    <form class="shrink-0 border-t border-slate-200 bg-white p-2.5" @submit.prevent="submitPrompt">
      <div
        class="rounded-xl border border-slate-300 bg-white p-2 shadow-sm transition focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100"
      >
        <textarea
          ref="input"
          v-model="prompt"
          rows="2"
          class="block max-h-28 min-h-11 w-full resize-none border-0 bg-transparent px-1 py-0.5 text-sm leading-5 text-slate-800 outline-none placeholder:text-slate-400"
          placeholder="Describe how you want to change the diagram..."
          aria-label="AI change request"
          data-testid="ai-chat-input"
          :disabled="isThinking"
          @keydown.enter.exact.prevent="submitPrompt"
        />
        <div class="mt-1 flex items-center justify-between gap-2 px-1">
          <span class="flex min-w-0 items-center gap-1 text-[10px] font-medium text-slate-500">
            <PencilSquareIcon class="h-3 w-3 shrink-0" />
            Editing {{ diagramTypeLabel }}
          </span>
          <span class="ml-auto text-[10px] text-slate-400">Enter ↵</span>
          <button
            type="submit"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            aria-label="Send message"
            data-testid="ai-chat-send"
            :disabled="!canSubmit"
          >
            <PaperAirplaneIcon class="h-4 w-4" />
          </button>
        </div>
      </div>
    </form>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ArrowRightIconRender from '@heroicons/vue/24/outline/ArrowRightIcon'
import CheckCircleIconRender from '@heroicons/vue/24/outline/CheckCircleIcon'
import CheckIconRender from '@heroicons/vue/24/outline/CheckIcon'
import CodeBracketSquareIconRender from '@heroicons/vue/24/outline/CodeBracketSquareIcon'
import DocumentCheckIconRender from '@heroicons/vue/24/outline/DocumentCheckIcon'
import ExclamationTriangleIconRender from '@heroicons/vue/24/outline/ExclamationTriangleIcon'
import PaperAirplaneIconRender from '@heroicons/vue/24/outline/PaperAirplaneIcon'
import PencilSquareIconRender from '@heroicons/vue/24/outline/PencilSquareIcon'
import ShieldCheckIconRender from '@heroicons/vue/24/outline/ShieldCheckIcon'
import SparklesIconRender from '@heroicons/vue/24/outline/SparklesIcon'
import XMarkIconRender from '@heroicons/vue/24/outline/XMarkIcon'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { MacroTypeValue } from '@/utils/analytics/catalog'

const ArrowRightIcon = { render: ArrowRightIconRender }
const CheckCircleIcon = { render: CheckCircleIconRender }
const CheckIcon = { render: CheckIconRender }
const CodeBracketSquareIcon = { render: CodeBracketSquareIconRender }
const DocumentCheckIcon = { render: DocumentCheckIconRender }
const ExclamationTriangleIcon = { render: ExclamationTriangleIconRender }
const PaperAirplaneIcon = { render: PaperAirplaneIconRender }
const PencilSquareIcon = { render: PencilSquareIconRender }
const ShieldCheckIcon = { render: ShieldCheckIconRender }
const SparklesIcon = { render: SparklesIconRender }
const XMarkIcon = { render: XMarkIconRender }

type Suggestion = {
  id: string
  label: string
  description: string
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
  codeVisible?: boolean
  diagramType?: string
  syntaxError?: string
  prototypeMode?: boolean
  initialMessages?: ChatMessage[]
}

const props = withDefaults(defineProps<Props>(), {
  codeVisible: false,
  diagramType: 'sequence',
  syntaxError: '',
  prototypeMode: false,
  initialMessages: () => [],
})

const emit = defineEmits<{
  close: []
  'toggle-code': []
  send: [prompt: string]
  apply: [message: ChatMessage]
}>()

const suggestions: Suggestion[] = [
  {
    id: 'add-error-path',
    label: 'Add an error handling path',
    description: 'Include failure, retry, or timeout behavior.',
  },
  {
    id: 'simplify-flow',
    label: 'Simplify the main flow',
    description: 'Reduce noise and make the happy path easier to scan.',
  },
  {
    id: 'highlight-steps',
    label: 'Highlight the key steps',
    description: 'Emphasize the most important interactions.',
  },
]

const prompt = ref('')
const input = ref<HTMLTextAreaElement | null>(null)
const messageList = ref<HTMLElement | null>(null)
const messages = ref<ChatMessage[]>(props.initialMessages.map((message) => ({ ...message })))
const isThinking = ref(false)
const syntaxDetailsOpen = ref(false)
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
const syntaxErrorSummary = computed(() => props.syntaxError.split('\n')[0])

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
        text: 'I prepared a focused update that keeps the current diagram structure intact.',
        preview: {
          title: 'Update ready',
          items: [
            `Keep the current ${diagramTypeLabel.value} format`,
            'Preserve the existing diagram content',
            'Add a review step before any change is applied',
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
  const scroll = () => {
    if (messageList.value) {
      messageList.value.scrollTop = messageList.value.scrollHeight
    }
  }
  scroll()
  window.setTimeout(scroll, 0)
}

watch([messages, isThinking], scrollToBottom, { deep: true })
watch(
  () => props.syntaxError,
  (error) => {
    if (!error) syntaxDetailsOpen.value = false
  },
)

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer)
})
</script>

<style scoped>
.ai-stage-item {
  position: relative;
}

.ai-stage-marker {
  position: absolute;
  left: -30px;
  top: -1px;
  display: flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 700;
}

.ai-stage-marker-active {
  box-shadow: 0 0 0 4px rgb(237 233 254);
  animation: ai-stage-pulse 1.5s ease-in-out infinite;
}

@keyframes ai-stage-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 3px rgb(237 233 254);
  }
  50% {
    box-shadow: 0 0 0 6px rgb(245 243 255);
  }
}
</style>
