<template>
  <aside
    v-if="open"
    class="ai-chat-panel"
    aria-label="AI diagram assistant"
    data-testid="ai-chat-panel"
    @keydown.esc="closePanel"
  >
    <header class="ai-chat-header">
      <div class="ai-chat-head-row">
        <strong>AI Chat</strong>
        <div class="ai-chat-head-actions">
          <button
            type="button"
            :aria-label="codeVisible ? 'Hide code editor' : 'Show code editor'"
            :aria-pressed="codeVisible"
            data-testid="ai-chat-code-toggle"
            @click="emit('toggle-code')"
          >
            {{ codeVisible ? 'Hide code' : 'Show code' }}
          </button>
          <button
            type="button"
            aria-label="Close AI chat"
            data-testid="ai-chat-close"
            @click="closePanel"
          >
            Close
          </button>
        </div>
      </div>

      <div
        v-if="visibleSyntaxError"
        class="ai-chat-syntax"
        role="status"
        data-testid="ai-chat-syntax-issue"
      >
        <span>{{ syntaxErrorSummary }}</span>
        <button
          type="button"
          data-testid="ai-chat-auto-fix"
          :disabled="isThinking"
          @click="repairSyntax"
        >
          Fix syntax
        </button>
      </div>
    </header>

    <main class="ai-chat-content">
      <section
        v-if="messages.length === 0 && !isThinking"
        class="ai-chat-empty"
        data-testid="ai-chat-empty-state"
      >
        <h3>What should change?</h3>
        <p>Suggested edits</p>
        <button
          v-for="suggestion in suggestions"
          :key="suggestion.id"
          type="button"
          class="ai-chat-quick-button"
          :data-testid="`ai-chat-suggestion-${suggestion.id}`"
          :title="suggestion.description"
          @click="selectSuggestion(suggestion)"
        >
          <strong>{{ suggestion.label }}</strong>
          <span>{{ suggestion.description }}</span>
        </button>
      </section>

      <section v-else class="ai-chat-conversation" data-testid="ai-chat-conversation">
        <article
          v-for="message in messages"
          :key="message.id"
          class="ai-chat-turn"
          :class="`is-${message.role}`"
          data-testid="ai-chat-message"
        >
          <p v-if="message.text">{{ message.text }}</p>
          <div v-if="message.preview" class="ai-chat-preview" data-testid="ai-change-preview">
            <strong>{{ message.preview.title }}</strong>
            <ul>
              <li v-for="item in message.preview.items" :key="item">{{ item }}</li>
            </ul>
            <button
              type="button"
              class="ai-chat-diff-toggle"
              :aria-expanded="isDiffOpen(message.id)"
              @click="toggleDiff(message.id)"
            >
              {{ isDiffOpen(message.id) ? 'Hide code diff' : 'View code diff' }}
            </button>
            <div v-if="isDiffOpen(message.id)" class="ai-chat-diff" data-testid="ai-chat-diff">
              <div class="ai-chat-diff-header">
                <strong>Code diff</strong>
                <span>{{ message.preview.diffLocation }}</span>
              </div>
              <div
                v-for="(line, index) in message.preview.diffLines"
                :key="`${message.id}-${index}`"
                class="ai-chat-diff-line"
                :class="`is-${line.type}`"
              >
                <span aria-hidden="true">
                  {{ line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ' }}
                </span>
                <code>{{ line.code }}</code>
              </div>
            </div>
          </div>
        </article>

        <article
          v-if="isThinking"
          class="ai-chat-progress"
          role="status"
          aria-live="polite"
          data-testid="ai-chat-thinking"
        >
          <ol>
            <li
              v-for="(stage, index) in stages"
              :key="stage.key"
              :class="stageClass(index)"
            >
              <span aria-hidden="true">{{ index + 1 }}</span>
              <strong>{{ stage.label }}</strong>
            </li>
          </ol>
        </article>
      </section>
    </main>

    <form class="ai-chat-composer" @submit.prevent="submitPrompt()">
      <textarea
        ref="input"
        v-model="prompt"
        rows="2"
        placeholder="Describe the diagram change..."
        aria-label="AI change request"
        data-testid="ai-chat-input"
        @keydown.enter.exact.prevent="submitPrompt()"
      />
      <button
        type="submit"
        aria-label="Send message"
        data-testid="ai-chat-send"
        :disabled="!canSubmit"
      >
        Send
      </button>
    </form>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  AI_CHAT_SUGGESTIONS,
  createCodePreview,
  type AIChatChangeKind,
  type AIChatMessage,
  type AIChatSuggestion,
} from './aiChatPrototype'
import {
  runAIChatSession,
  type AIChatSessionStage,
} from '@/services/AIChatSessionService'

type Props = {
  open: boolean
  codeVisible?: boolean
  diagramType?: string
  syntaxError?: string
  syntaxRepairRequestId?: number
  currentCode?: string
  diagramTitle?: string
  diagramlyDiagramId?: string
  initialMessages?: AIChatMessage[]
}

const props = withDefaults(defineProps<Props>(), {
  codeVisible: false,
  diagramType: 'sequence',
  syntaxError: '',
  syntaxRepairRequestId: 0,
  currentCode: '',
  diagramTitle: '',
  diagramlyDiagramId: '',
  initialMessages: () => [],
})

const emit = defineEmits<{
  close: []
  'toggle-code': []
  send: [prompt: string]
  apply: [message: AIChatMessage]
  'apply-code': [code: string]
  'diagramly-diagram-bound': [diagramId: string]
}>()

const suggestions = AI_CHAT_SUGGESTIONS
const stages: Array<{ key: AIChatSessionStage; label: string }> = [
  { key: 'ensuring', label: 'Preparing diagram' },
  { key: 'queued', label: 'Understanding request' },
  { key: 'processing', label: 'Updating diagram' },
  { key: 'generating', label: 'Generating code' },
  { key: 'syncing', label: 'Syncing changes' },
]

const prompt = ref('')
const input = ref<HTMLTextAreaElement | null>(null)
const messages = ref<AIChatMessage[]>(props.initialMessages.map(cloneMessage))
const isThinking = ref(false)
const activeStage = ref<AIChatSessionStage | null>(null)
const openDiffIds = ref<string[]>([])
const activeDiagramId = ref(props.diagramlyDiagramId.trim())
const activeCode = ref(props.currentCode)
const activeVersionId = ref('')
const syntaxResolved = ref(false)
const lastHandledSyntaxRepairRequestId = ref(0)
let activeController: AbortController | null = null
let messageSequence = 0

const canSubmit = computed(() => prompt.value.trim().length > 0 && !isThinking.value)
const visibleSyntaxError = computed(() => Boolean(props.syntaxError) && !syntaxResolved.value)
const syntaxErrorSummary = computed(() => props.syntaxError.split('\n')[0])
const activeStageIndex = computed(() => stages.findIndex((stage) => stage.key === activeStage.value))
const diagramTypeLabel = computed(() => {
  const labels: Record<string, string> = {
    sequence: 'Sequence',
    mermaid: 'Mermaid',
    plantuml: 'PlantUML',
    openapi: 'OpenAPI',
  }
  return labels[props.diagramType.toLowerCase()] || 'Current'
})

function cloneMessage(message: AIChatMessage): AIChatMessage {
  return {
    ...message,
    preview: message.preview
      ? {
          ...message.preview,
          items: [...message.preview.items],
          diffLines: message.preview.diffLines.map((line) => ({ ...line })),
        }
      : undefined,
  }
}

function nextMessageId(role: AIChatMessage['role']): string {
  messageSequence += 1
  return `${role}-${Date.now()}-${messageSequence}`
}

function selectSuggestion(suggestion: AIChatSuggestion): void {
  prompt.value = suggestion.label
  nextTick(() => input.value?.focus())
}

function stageClass(index: number): string {
  if (index < activeStageIndex.value) return 'is-complete'
  if (index === activeStageIndex.value) return 'is-active'
  return 'is-pending'
}

function isDiffOpen(messageId: string): boolean {
  return openDiffIds.value.includes(messageId)
}

function toggleDiff(messageId: string): void {
  openDiffIds.value = isDiffOpen(messageId)
    ? openDiffIds.value.filter((id) => id !== messageId)
    : [...openDiffIds.value, messageId]
}

function cancelActiveRequest(): void {
  activeController?.abort()
  activeController = null
  isThinking.value = false
  activeStage.value = null
}

function closePanel(): void {
  cancelActiveRequest()
  emit('close')
}

function repairSyntax(): void {
  void submitPrompt(
    'syntax_repair',
    'Fix the current syntax issue without changing the rest of the diagram.',
  )
}

async function submitPrompt(
  kind: AIChatChangeKind = 'request',
  textOverride?: string,
): Promise<boolean> {
  const text = (textOverride ?? prompt.value).trim()
  if (!text || isThinking.value) return false

  const previousCode = activeCode.value
  const previousVersionId = activeVersionId.value
  const controller = new AbortController()
  activeController = controller
  isThinking.value = true
  activeStage.value = activeDiagramId.value ? 'queued' : 'ensuring'
  messages.value.push({ id: nextMessageId('user'), role: 'user', text })
  prompt.value = ''
  emit('send', text)

  try {
    const result = await runAIChatSession({
      diagramId: activeDiagramId.value,
      diagramCode: previousCode,
      diagramType: props.diagramType,
      prompt: text,
      title: props.diagramTitle,
      ...(kind === 'syntax_repair' ? { errorMessage: props.syntaxError } : {}),
      signal: controller.signal,
      onStage(stage) {
        if (activeController === controller) activeStage.value = stage
      },
      async onDiagramBound(diagramId) {
        if (activeController !== controller) return
        activeDiagramId.value = diagramId
        emit('diagramly-diagram-bound', diagramId)
      },
    })
    if (activeController !== controller) return false

    activeDiagramId.value = result.diagramId
    activeCode.value = result.updatedCode
    activeVersionId.value = result.versionId
    const preview = createCodePreview(
      diagramTypeLabel.value,
      kind,
      previousCode,
      result.updatedCode,
    )
    preview.versionId = result.versionId
    preview.previousVersionId = previousVersionId || undefined

    const message: AIChatMessage = {
      id: nextMessageId('assistant'),
      role: 'assistant',
      text: '',
      preview,
    }
    messages.value.push(message)
    if (kind === 'syntax_repair') syntaxResolved.value = true
    emit('apply-code', result.updatedCode)
    emit('apply', message)
    return true
  } catch (error) {
    if (activeController !== controller || (error instanceof Error && error.name === 'AbortError')) {
      return false
    }

    const detail = error instanceof Error ? error.message : 'Unknown error'
    messages.value.push({
      id: nextMessageId('assistant'),
      role: 'assistant',
      text: `AI Chat could not apply the change: ${detail}`,
    })
    return false
  } finally {
    if (activeController === controller) {
      activeController = null
      isThinking.value = false
      activeStage.value = null
    }
  }
}

watch(
  () => props.diagramlyDiagramId,
  (diagramId) => {
    if (!isThinking.value) activeDiagramId.value = diagramId.trim()
  },
)

watch(
  () => props.currentCode,
  (code) => {
    if (!isThinking.value) activeCode.value = code
  },
)

watch(
  () => props.syntaxError,
  (syntaxError) => {
    if (syntaxError) syntaxResolved.value = false
  },
)

watch(
  [() => props.syntaxRepairRequestId, () => props.open],
  ([requestId, open]) => {
    if (
      !open ||
      !requestId ||
      requestId === lastHandledSyntaxRepairRequestId.value ||
      !props.syntaxError ||
      isThinking.value
    ) {
      return
    }

    lastHandledSyntaxRepairRequestId.value = requestId
    repairSyntax()
  },
  { immediate: true },
)

watch(
  () => props.open,
  (open) => {
    if (!open) cancelActiveRequest()
  },
)

onBeforeUnmount(cancelActiveRequest)
</script>
