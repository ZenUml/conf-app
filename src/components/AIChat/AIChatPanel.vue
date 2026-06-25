<template>
  <aside
    v-if="open"
    class="ai-chat-panel"
    aria-label="AI diagram assistant"
    data-testid="ai-chat-panel"
    @keydown.esc="handleEscape"
  >
    <header class="ai-chat-header">
      <div class="ai-chat-head-row" data-testid="ai-chat-header-row">
        <div class="ai-chat-identity">
          <span class="ai-chat-identity-icon" aria-hidden="true" />
          <span class="ai-chat-identity-label">AI</span>
          <button
            v-if="visibleSyntaxError"
            type="button"
            class="ai-chat-syntax"
            aria-label="Show 1 syntax issue"
            :aria-expanded="syntaxDetailsOpen"
            data-testid="ai-chat-syntax-indicator"
            @click.stop="toggleSyntaxDetails"
          >
            <span class="ai-chat-syntax-icon" aria-hidden="true" />
            <span>Syntax</span>
            <span class="ai-chat-syntax-count">1</span>
          </button>
        </div>

        <div class="ai-chat-head-actions">
          <button
            type="button"
            class="ai-chat-head-button"
            :aria-label="codeVisible ? 'Hide code editor' : 'Show code editor'"
            :aria-pressed="codeVisible"
            data-testid="ai-chat-code-toggle"
            @click="toggleCode"
          >
            <span class="ai-chat-code-icon" aria-hidden="true" />
            <span>{{ codeVisible ? 'Hide code' : 'Show code' }}</span>
          </button>
          <button
            type="button"
            class="ai-chat-head-button ai-chat-close"
            aria-label="Close AI chat"
            data-testid="ai-chat-close"
            @click="closePanel"
          >
            <span class="ai-chat-close-icon" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        v-if="visibleSyntaxError && syntaxDetailsOpen"
        class="ai-chat-popover"
        role="dialog"
        aria-label="Syntax issue details"
        data-testid="ai-chat-syntax-details"
        @click.stop
      >
        <strong>1 syntax issue</strong>
        <p>{{ syntaxErrorSummary }}</p>
        <div class="ai-chat-popover-action">
          <button
            type="button"
            class="ai-chat-primary-button"
            data-testid="ai-chat-auto-fix"
            @click="repairSyntax"
          >
            Fix syntax
          </button>
        </div>
      </div>
    </header>

    <div ref="messageList" class="ai-chat-scroll" :inert="overlayOpen || undefined">
      <section
        v-if="messages.length === 0 && !isThinking && !isRestoringVersion"
        class="ai-chat-empty"
        data-testid="ai-chat-empty-state"
      >
        <h3>What should change?</h3>
        <div class="ai-chat-quick">
          <p class="ai-chat-label">Suggested edits</p>
          <div class="ai-chat-quick-list">
            <button
              v-for="suggestion in suggestions"
              :key="suggestion.id"
              type="button"
              class="ai-chat-quick-button"
              :title="suggestion.description"
              :aria-label="`${suggestion.label}. ${suggestion.description}`"
              @click="selectSuggestion(suggestion)"
            >
              <span class="ai-chat-quick-copy">
                <strong>{{ suggestion.label }}</strong>
                <span class="ai-chat-quick-description">{{ suggestion.description }}</span>
              </span>
              <span class="ai-chat-quick-arrow" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <section v-else class="ai-chat-conversation" data-testid="ai-chat-conversation">
        <article v-for="message in messages" :key="message.id" class="ai-chat-turn">
          <div v-if="message.role === 'user'" class="ai-chat-user-bubble">
            {{ message.text }}
          </div>

          <div v-else class="ai-chat-assistant-message">
            <p v-if="message.text" class="ai-chat-assistant-text">{{ message.text }}</p>
            <div v-if="message.preview" class="ai-chat-preview" data-testid="ai-change-preview">
              <div class="ai-chat-preview-header">
                <span>{{ message.preview.title }}</span>
                <button
                  v-if="message.preview.previousVersionId"
                  type="button"
                  class="ai-chat-undo"
                  data-testid="ai-chat-undo"
                  :disabled="isRestoringVersion || isThinking"
                  @click="undoPreview(message.preview)"
                >
                  {{ restoringAction === 'undo' ? 'Undoing...' : 'Undo' }}
                </button>
              </div>
              <ul class="ai-chat-changes">
                <li v-for="item in message.preview.items" :key="item">
                  <span class="ai-chat-change-icon" aria-hidden="true" />
                  <span>{{ item }}</span>
                </li>
              </ul>
              <button
                type="button"
                class="ai-chat-diff-toggle"
                :aria-expanded="isDiffOpen(message.id)"
                @click="toggleDiff(message.id)"
              >
                <span>{{ isDiffOpen(message.id) ? 'Hide code diff' : 'View code diff' }}</span>
                <span
                  class="ai-chat-disclosure-icon"
                  :class="{ 'is-open': isDiffOpen(message.id) }"
                  aria-hidden="true"
                />
              </button>
              <div v-if="isDiffOpen(message.id)" class="ai-chat-diff" data-testid="ai-chat-diff">
                <div class="ai-chat-diff-header">
                  <span class="ai-chat-diff-title">
                    <span>Code diff</span>
                    <span class="ai-chat-diff-location">{{ message.preview.diffLocation }}</span>
                  </span>
                  <span class="ai-chat-diff-actions">
                    <button
                      type="button"
                      class="ai-chat-diff-action"
                      aria-label="Expand code diff"
                      title="Expand code diff"
                      data-testid="ai-chat-diff-expand"
                      @click="openExpandedDiff(message.id)"
                    >
                      <span class="ai-chat-expand-icon" aria-hidden="true" />
                    </button>
                  </span>
                </div>
                <div class="ai-chat-diff-code">
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
              <div class="ai-chat-preview-actions">
                <button type="button" class="ai-chat-secondary-button" @click="refineChange">
                  Refine
                </button>
              </div>
            </div>
          </div>
        </article>

        <article
          v-if="isThinking || isRestoringVersion"
          class="ai-chat-turn ai-chat-assistant-message"
          role="status"
          aria-live="polite"
          data-testid="ai-chat-thinking"
        >
          <ol class="ai-chat-progress">
            <li
              v-for="(stage, index) in activeStages"
              :key="stage"
              class="ai-chat-stage"
              :class="stageClass(index)"
            >
              <span class="ai-chat-stage-marker">
                <span
                  v-if="stageIndex > index"
                  class="ai-chat-stage-check-icon"
                  aria-hidden="true"
                />
                <template v-else>{{ index + 1 }}</template>
              </span>
              <strong>{{ stageIndex > index ? activeCompletedStages[index] : stage }}</strong>
            </li>
          </ol>
        </article>
      </section>
    </div>

    <section
      v-if="expandedDiffPreview"
      class="ai-chat-diff-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded code diff"
      data-testid="ai-chat-diff-fullscreen"
      @click.self="closeExpandedDiff"
    >
      <div class="ai-chat-diff-fullscreen-panel">
        <header class="ai-chat-diff-fullscreen-header">
          <span class="ai-chat-diff-fullscreen-title">
            <span>Code diff</span>
            <span class="ai-chat-diff-location">{{ expandedDiffPreview.diffLocation }}</span>
          </span>
          <button
            type="button"
            class="ai-chat-diff-action"
            aria-label="Close expanded code diff"
            title="Close expanded code diff"
            data-testid="ai-chat-diff-fullscreen-close"
            @click="closeExpandedDiff"
          >
            <span class="ai-chat-close-icon" aria-hidden="true" />
          </button>
        </header>
        <div class="ai-chat-diff-code ai-chat-diff-code-expanded">
          <div
            v-for="(line, index) in expandedDiffPreview.diffLines"
            :key="`expanded-${expandedDiffMessageId}-${index}`"
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
    </section>

    <section
      v-if="historyOpen"
      class="ai-chat-history-panel"
      role="region"
      aria-label="Diagram versions"
      data-testid="ai-chat-history-panel"
    >
      <header class="ai-chat-history-header">
        <h3>Diagram versions</h3>
        <button
          type="button"
          class="ai-chat-head-button ai-chat-close"
          aria-label="Close diagram versions"
          @click="closeHistory"
        >
          <span class="ai-chat-close-icon" aria-hidden="true" />
        </button>
      </header>
      <div
        v-if="isVersionListLoading"
        class="ai-chat-history-state"
        role="status"
        data-testid="ai-chat-history-loading"
      >
        Loading saved versions...
      </div>
      <div
        v-else-if="hasVersionLoadFailed"
        class="ai-chat-history-state"
        role="status"
        data-testid="ai-chat-history-error"
      >
        <p>Saved versions could not be loaded.</p>
        <button type="button" class="ai-chat-history-retry" @click="retryLoadPersistedVersions">
          Retry
        </button>
      </div>
      <ol v-else class="ai-chat-history-list">
        <li
          v-for="version in reversedVersions"
          :key="version.id"
          class="ai-chat-history-item"
          :class="{ 'is-current': version.id === currentVersionId }"
        >
          <div>
            <p class="ai-chat-history-title">
              <strong>v{{ version.versionNumber }}</strong>
              <span>{{ version.summary }}</span>
            </p>
            <p class="ai-chat-history-detail">{{ version.detail }}</p>
          </div>
          <button
            type="button"
            class="ai-chat-rollback"
            :disabled="version.id === currentVersionId || isRestoringVersion"
            @click="restoreVersion(version)"
          >
            {{
              version.id === currentVersionId
                ? 'Current'
                : restoringVersionId === version.id
                  ? 'Restoring...'
                  : 'Restore version'
            }}
          </button>
          <div class="ai-chat-history-meta">
            {{ version.time }} · {{ version.syntaxResolved ? 'Syntax valid' : '1 syntax issue' }}
          </div>
        </li>
      </ol>
    </section>

    <form
      class="ai-chat-composer"
      :inert="overlayOpen || undefined"
      @submit.prevent="submitPrompt()"
    >
      <div class="ai-chat-compose-box">
        <textarea
          ref="input"
          v-model="prompt"
          rows="2"
          placeholder="Describe the diagram change..."
          aria-label="AI change request"
          data-testid="ai-chat-input"
          :disabled="isRestoringVersion"
          @keydown.enter.exact.prevent="submitPrompt()"
        />
        <div class="ai-chat-compose-meta">
          <button
            type="button"
            class="ai-chat-history-trigger"
            :aria-expanded="historyOpen"
            aria-label="Open diagram versions"
            data-testid="ai-chat-history-trigger"
            @click="openHistory"
          >
            <span class="ai-chat-history-icon" aria-hidden="true" />
            <span>Diagram versions</span>
            <span class="ai-chat-history-count" :class="{ 'is-loading': isVersionListLoading }">
              {{ versionCountLabel }}
            </span>
          </button>
          <span class="ai-chat-compose-actions">
            <span class="ai-chat-compose-status">{{ composeStatus }}</span>
            <button
              type="submit"
              class="ai-chat-send"
              aria-label="Send message"
              data-testid="ai-chat-send"
              :disabled="!canSubmit"
            >
              <span class="ai-chat-send-icon" aria-hidden="true" />
            </button>
          </span>
        </div>
      </div>
    </form>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  AI_CHAT_SUGGESTIONS,
  createPrototypePreview,
  createCodePreview,
  formatVersionTime,
  type AIChatChangeKind,
  type AIChatChangePreview,
  type AIChatMessage,
  type AIChatSuggestion,
  type AIChatVersion,
} from './aiChatPrototype'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { MacroTypeValue } from '@/utils/analytics/catalog'
import {
  ensureDiagramlyDiagram,
  getDiagramlyJobStatus,
  getDiagramlyVersions,
  restoreDiagramlyVersion,
  startDiagramChatModification,
  type DiagramlyJobStatus,
  type DiagramlyVersion,
} from '@/services/GenerateService'


type Props = {
  open: boolean
  codeVisible?: boolean
  diagramType?: string
  syntaxError?: string
  syntaxRepairRequestId?: number
  prototypeMode?: boolean
  currentCode?: string
  diagramTitle?: string
  diagramlyDiagramId?: string
  initialMessages?: AIChatMessage[]
}
type PersistedVersionsStatus = 'idle' | 'loading' | 'loaded' | 'failed'

const props = withDefaults(defineProps<Props>(), {
  codeVisible: false,
  diagramType: 'sequence',
  syntaxError: '',
  syntaxRepairRequestId: 0,
  prototypeMode: false,
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
const stages = ['Understanding request', 'Updating diagram', 'Syncing changes']
const completedStages = ['Understood', 'Updated', 'Synced']
const restoreStages = ['Restoring version', 'Applying code', 'Saving history']
const completedRestoreStages = ['Restored', 'Applied', 'Saved']

const prompt = ref('')
const input = ref<HTMLTextAreaElement | null>(null)
const messageList = ref<HTMLElement | null>(null)
const messages = ref<AIChatMessage[]>(props.initialMessages.map((message) => ({ ...message })))
const isThinking = ref(false)
const stageIndex = ref(0)
const syntaxDetailsOpen = ref(false)
const syntaxResolved = ref(false)
const lastHandledSyntaxRepairRequestId = ref(0)
const historyOpen = ref(false)
const isLoadingVersions = ref(false)
const persistedVersionsStatus = ref<PersistedVersionsStatus>(props.diagramlyDiagramId ? 'idle' : 'loaded')
const isRestoringVersion = ref(false)
const restoringVersionId = ref('')
const restoringAction = ref<'undo' | 'rollback' | null>(null)
const openDiffIds = ref<string[]>([])
const expandedDiffMessageId = ref<string | null>(null)
const activeDiagramlyDiagramId = ref(props.diagramlyDiagramId || '')
const versions = ref<AIChatVersion[]>([
  {
    id: 'local-initial',
    versionNumber: 1,
    summary: 'Initial version',
    detail: 'Diagram state before the current AI Chat session.',
    syntaxResolved: !props.syntaxError,
    time: formatVersionTime(),
    code: props.currentCode,
  },
])
const timers: ReturnType<typeof setTimeout>[] = []
const activeRequestId = ref(0)

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

const canSubmit = computed(() => prompt.value.trim().length > 0 && !isThinking.value && !isRestoringVersion.value)
const syntaxErrorSummary = computed(() => props.syntaxError.split('\n')[0])
const visibleSyntaxError = computed(() => Boolean(props.syntaxError) && !syntaxResolved.value)
const currentVersionId = computed(() => versions.value[versions.value.length - 1]?.id || '')
const reversedVersions = computed(() => [...versions.value].reverse())
const currentCode = computed(() => props.currentCode || '')
const isVersionListLoading = computed(() => (
  Boolean(activeDiagramlyDiagramId.value)
  && (persistedVersionsStatus.value === 'idle' || persistedVersionsStatus.value === 'loading')
))
const hasVersionLoadFailed = computed(() => persistedVersionsStatus.value === 'failed')
const versionCountLabel = computed(() => {
  if (isVersionListLoading.value) return '...'
  if (hasVersionLoadFailed.value) return '!'
  return String(versions.value.length)
})
const activeStages = computed(() => (isRestoringVersion.value ? restoreStages : stages))
const activeCompletedStages = computed(() => (isRestoringVersion.value ? completedRestoreStages : completedStages))
const composeStatus = computed(() => {
  if (isRestoringVersion.value) return 'Restoring'
  if (isThinking.value) return 'Updating'
  if (isVersionListLoading.value) return 'Syncing'
  return 'Ready'
})
const expandedDiffPreview = computed(() => {
  const message = messages.value.find((item) => item.id === expandedDiffMessageId.value)
  return message?.preview || null
})
const overlayOpen = computed(() => historyOpen.value || Boolean(expandedDiffPreview.value))

function analyticsBase() {
  return {
    feature_area: 'ai' as const,
    surface: 'editor' as const,
    macro_type: macroType.value,
  }
}

function selectSuggestion(suggestion: AIChatSuggestion) {
  prompt.value = suggestion.label
  trackAnalyticsEvent('ai_chat_suggestion_selected', {
    ...analyticsBase(),
    suggestion_id: suggestion.id,
  })
  focusInput()
}

function focusInput() {
  historyOpen.value = false
  nextTick(() => input.value?.focus())
}

function clearTimers() {
  timers.splice(0).forEach(clearTimeout)
}

function nextVersionNumber() {
  return Math.max(0, ...versions.value.map((version) => version.versionNumber || 0)) + 1
}

function toAIChatVersion(version: DiagramlyVersion): AIChatVersion {
  const instruction = version.instruction?.trim()
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    summary: version.versionNumber === 1 ? 'Initial version' : instruction || `Version ${version.versionNumber}`,
    detail: instruction
      ? `Created from: ${instruction}`
      : `Saved Diagramly version ${version.versionNumber}.`,
    syntaxResolved: true,
    time: formatVersionTime(version.createdAt),
    code: version.content?.code || '',
  }
}

async function loadPersistedVersions() {
  const diagramId = activeDiagramlyDiagramId.value
  if (!diagramId) {
    persistedVersionsStatus.value = 'loaded'
    return
  }
  if (isLoadingVersions.value) return

  isLoadingVersions.value = true
  persistedVersionsStatus.value = 'loading'
  try {
    const result = await getDiagramlyVersions(diagramId)
    if (result?.versions?.length) {
      versions.value = [...result.versions]
        .sort((a, b) => a.versionNumber - b.versionNumber)
        .map(toAIChatVersion)
    }
    persistedVersionsStatus.value = 'loaded'
  } catch (error) {
    console.warn('Failed to load Diagramly versions', error)
    persistedVersionsStatus.value = 'failed'
  } finally {
    isLoadingVersions.value = false
  }
}

function retryLoadPersistedVersions() {
  loadPersistedVersions()
}

async function ensureActiveDiagramlyDiagram(initialCode: string) {
  if (activeDiagramlyDiagramId.value) {
    return activeDiagramlyDiagramId.value
  }

  const result = await ensureDiagramlyDiagram({
    diagramCode: initialCode,
    diagramType: props.diagramType,
    title: props.diagramTitle,
  })
  activeDiagramlyDiagramId.value = result.diagramId
  persistedVersionsStatus.value = 'loaded'
  emit('diagramly-diagram-bound', result.diagramId)

  if (result.versionId) {
    versions.value = [
      {
        ...versions.value[0],
        id: result.versionId,
        versionNumber: result.versionNumber || 1,
        time: result.createdAt ? formatVersionTime(result.createdAt) : versions.value[0].time,
        code: initialCode,
      },
    ]
  }

  return result.diagramId
}

function submitPrompt(kind: AIChatChangeKind = 'request', textOverride?: string) {
  const text = (textOverride ?? prompt.value).trim()
  if (!text || isThinking.value) return

  clearTimers()
  messages.value.push({
    id: `user-${Date.now()}`,
    role: 'user',
    text,
  })
  prompt.value = ''
  historyOpen.value = false

  trackAnalyticsEvent('ai_chat_prompt_submitted', {
    ...analyticsBase(),
    generation_source: kind === 'syntax_repair' ? 'syntax_repair' : 'chat_panel',
    prompt_length: text.length,
    chat_message_count: messages.value.length,
    change_kind: kind,
  })
  emit('send', text)

  if (props.prototypeMode) {
    isThinking.value = true
    stageIndex.value = 0
    timers.push(
      setTimeout(() => {
        stageIndex.value = 1
      }, 350),
      setTimeout(() => {
        stageIndex.value = 2
      }, 700),
      setTimeout(() => completePrototypeRequest(kind), 1050),
    )
    return
  }

  runDiagramlyRequest(text, kind)
}

function completePrototypeRequest(kind: AIChatChangeKind) {
  const previousVersionId = currentVersionId.value
  const preview = createPrototypePreview(diagramTypeLabel.value, kind, syntaxResolved.value)
  const nextVersion = addVersion(
    kind === 'syntax_repair' ? 'Fixed syntax issue' : 'Updated diagram flow',
    kind === 'syntax_repair'
      ? 'Corrected the invalid syntax and synchronized the preview.'
      : 'Applied the requested change and synchronized the preview.',
    true,
  )
  preview.versionId = nextVersion.id
  preview.previousVersionId = previousVersionId

  const message: AIChatMessage = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    text: '',
    preview,
  }
  messages.value.push(message)
  syntaxResolved.value = true
  syntaxDetailsOpen.value = false
  isThinking.value = false
  trackAnalyticsEvent('ai_chat_change_applied', {
    ...analyticsBase(),
    chat_message_count: messages.value.length,
    change_kind: kind,
    version_id: nextVersion.id,
  })
  emit('apply', message)
}

async function runDiagramlyRequest(text: string, kind: AIChatChangeKind) {
  const requestId = activeRequestId.value + 1
  activeRequestId.value = requestId
  const previousCode = currentCode.value

  isThinking.value = true
  stageIndex.value = 0

  try {
    const diagramId = await ensureActiveDiagramlyDiagram(previousCode)
    if (activeRequestId.value !== requestId) return

    const { jobId } = await startDiagramChatModification({
      diagramId,
      diagramCode: previousCode,
      prompt: text,
      diagramType: props.diagramType,
      errorMessage: kind === 'syntax_repair' ? props.syntaxError : undefined,
    })
    if (activeRequestId.value !== requestId) return
    stageIndex.value = 1
    pollDiagramlyJob(jobId, requestId, kind, previousCode)
  } catch (error) {
    handleDiagramlyError(error, requestId)
  }
}

function pollDiagramlyJob(
  jobId: string,
  requestId: number,
  kind: AIChatChangeKind,
  previousCode: string,
  attempts = 0,
) {
  if (activeRequestId.value !== requestId) return

  getDiagramlyJobStatus(jobId)
    .then((status) => {
      if (activeRequestId.value !== requestId) return
      updateStageFromJob(status)

      if (status.status === 'COMPLETED') {
        const updatedCode = status.output?.diagramCode
        if (!updatedCode) {
          throw new Error('Job completed but no diagram code was returned')
        }
        completeDiagramlyRequest(kind, previousCode, updatedCode, status.output)
        return
      }

      if (status.status === 'FAILED' || status.status === 'CANCELLED') {
        throw new Error(status.error || status.message || `Diagram update ${status.status.toLowerCase()}`)
      }

      if (attempts >= 30) {
        throw new Error('Diagram update timed out after 60 seconds')
      }

      timers.push(setTimeout(() => pollDiagramlyJob(jobId, requestId, kind, previousCode, attempts + 1), 2000))
    })
    .catch((error) => handleDiagramlyError(error, requestId))
}

function updateStageFromJob(status: DiagramlyJobStatus) {
  if (status.status === 'GENERATING') {
    stageIndex.value = 2
    return
  }
  if (status.status === 'PROCESSING') {
    stageIndex.value = 1
  }
}

function completeDiagramlyRequest(
  kind: AIChatChangeKind,
  previousCode: string,
  updatedCode: string,
  versionInfo?: DiagramlyJobStatus['output'],
) {
  const previousVersionId = currentVersionId.value
  const preview = createCodePreview(diagramTypeLabel.value, kind, previousCode, updatedCode)
  const nextVersion = addVersion(
    kind === 'syntax_repair' ? 'Fixed syntax issue' : 'Updated diagram flow',
    kind === 'syntax_repair'
      ? 'Corrected the invalid syntax and synchronized the preview.'
      : 'Applied the requested change and synchronized the preview.',
    true,
    updatedCode,
    {
      id: versionInfo?.versionId,
      versionNumber: versionInfo?.versionNumber,
      time: versionInfo?.createdAt ? formatVersionTime(versionInfo.createdAt) : undefined,
    },
  )
  preview.versionId = nextVersion.id
  preview.previousVersionId = previousVersionId

  const message: AIChatMessage = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    text: '',
    preview,
  }
  messages.value.push(message)
  syntaxResolved.value = true
  syntaxDetailsOpen.value = false
  isThinking.value = false
  stageIndex.value = 0
  trackAnalyticsEvent('ai_chat_change_applied', {
    ...analyticsBase(),
    chat_message_count: messages.value.length,
    change_kind: kind,
    version_id: nextVersion.id,
  })
  emit('apply-code', updatedCode)
  emit('apply', message)
}

function handleDiagramlyError(error: unknown, requestId: number) {
  if (activeRequestId.value !== requestId) return
  const message = error instanceof Error ? error.message : String(error || 'Diagram update failed')
  messages.value.push({
    id: `assistant-error-${Date.now()}`,
    role: 'assistant',
    text: message,
  })
  isThinking.value = false
  stageIndex.value = 0
}

function addVersion(
  summary: string,
  detail: string,
  resolved = syntaxResolved.value,
  code?: string,
  versionInfo: { id?: string; versionNumber?: number; time?: string } = {},
): AIChatVersion {
  const version: AIChatVersion = {
    id: versionInfo.id || `local-${Date.now()}`,
    versionNumber: versionInfo.versionNumber || nextVersionNumber(),
    summary,
    detail,
    syntaxResolved: resolved,
    time: versionInfo.time || formatVersionTime(),
    code,
  }
  versions.value.push(version)
  return version
}

function stageClass(index: number) {
  return {
    'is-done': stageIndex.value > index,
    'is-active': stageIndex.value === index,
  }
}

function isDiffOpen(messageId: string) {
  return openDiffIds.value.includes(messageId)
}

function toggleDiff(messageId: string) {
  const opened = !isDiffOpen(messageId)
  openDiffIds.value = opened
    ? [...openDiffIds.value, messageId]
    : openDiffIds.value.filter((id) => id !== messageId)
  if (!opened && expandedDiffMessageId.value === messageId) {
    closeExpandedDiff()
  }
  trackAnalyticsEvent('ai_chat_diff_toggled', {
    ...analyticsBase(),
    interaction_state: opened ? 'opened' : 'closed',
  })
}

function openExpandedDiff(messageId: string) {
  const hasPreview = messages.value.some((message) => message.id === messageId && message.preview)
  if (!hasPreview) return
  expandedDiffMessageId.value = messageId
  historyOpen.value = false
  syntaxDetailsOpen.value = false
  trackAnalyticsEvent('ai_chat_diff_toggled', {
    ...analyticsBase(),
    interaction_state: 'shown',
    ui_component: 'code_diff_fullscreen',
  })
}

function closeExpandedDiff() {
  if (!expandedDiffMessageId.value) return
  expandedDiffMessageId.value = null
  trackAnalyticsEvent('ai_chat_diff_toggled', {
    ...analyticsBase(),
    interaction_state: 'hidden',
    ui_component: 'code_diff_fullscreen',
  })
}

async function undoPreview(preview: AIChatChangePreview) {
  const targetId = preview.previousVersionId
  if (!targetId) return
  const target = versions.value.find((version) => version.id === targetId)
  if (!target) return

  const restored = await restoreTargetVersion(target, 'undo')
  if (restored) {
    preview.previousVersionId = undefined
  }
}

function refineChange() {
  prompt.value = 'Keep the retry path, but make the timeout return a clear user-facing response.'
  focusInput()
}

function openHistory() {
  syntaxDetailsOpen.value = false
  historyOpen.value = true
  trackAnalyticsEvent('ai_chat_history_opened', {
    ...analyticsBase(),
    version_id: currentVersionId.value,
  })
}

function closeHistory() {
  historyOpen.value = false
}

function restoreVersion(version: AIChatVersion) {
  if (version.id === currentVersionId.value) return
  restoreTargetVersion(version, 'rollback')
}

async function restoreTargetVersion(version: AIChatVersion, kind: 'undo' | 'rollback'): Promise<boolean> {
  if (isRestoringVersion.value || isThinking.value) return false
  isRestoringVersion.value = true
  restoringVersionId.value = version.id
  restoringAction.value = kind
  stageIndex.value = 0

  let restored: AIChatVersion
  try {
    if (activeDiagramlyDiagramId.value && !version.id.startsWith('local-')) {
      const result = await restoreDiagramlyVersion(activeDiagramlyDiagramId.value, version.id)
      restored = toAIChatVersion(result.version)
      versions.value.push(restored)
      stageIndex.value = 1
      if (result.diagramCode !== undefined) {
        emit('apply-code', result.diagramCode)
      }
    } else {
      restored = addVersion(
        kind === 'undo' ? `Undo to v${version.versionNumber}` : `Restored v${version.versionNumber}`,
        `Restored the diagram state from ${version.summary}.`,
        version.syntaxResolved,
        version.code,
      )
      if (version.code !== undefined) {
        emit('apply-code', version.code)
      }
    }
    stageIndex.value = 2
  } catch (error) {
    handleDiagramlyError(error, activeRequestId.value)
    return false
  } finally {
    isRestoringVersion.value = false
    restoringVersionId.value = ''
    restoringAction.value = null
    stageIndex.value = 0
  }

  syntaxResolved.value = version.syntaxResolved
  messages.value.push({
    id: `assistant-${kind}-${Date.now()}`,
    role: 'assistant',
    text: '',
    preview: {
      title: kind === 'undo' ? 'Changes undone' : 'Version restored',
      kind,
      versionId: restored.id,
      items: [`Restored v${version.versionNumber} and saved the result as v${restored.versionNumber}.`],
      diffLocation: 'Complete diagram version',
      diffLines: [{ type: 'context', code: `Restored v${version.versionNumber}: ${version.summary}` }],
    },
  })
  historyOpen.value = false
  trackAnalyticsEvent(kind === 'undo' ? 'ai_chat_change_undone' : 'ai_chat_version_restored', {
    ...analyticsBase(),
    change_kind: kind,
    version_id: version.id,
  })
  return true
}

function toggleSyntaxDetails() {
  if (!visibleSyntaxError.value) return
  syntaxDetailsOpen.value = !syntaxDetailsOpen.value
  trackAnalyticsEvent('ai_chat_syntax_details_toggled', {
    ...analyticsBase(),
    interaction_state: syntaxDetailsOpen.value ? 'opened' : 'closed',
  })
}

function repairSyntax() {
  if (isThinking.value || isRestoringVersion.value) return
  const repairText = 'Fix the current syntax issue without changing the rest of the diagram.'
  syntaxDetailsOpen.value = false
  trackAnalyticsEvent('ai_chat_syntax_repair_requested', {
    ...analyticsBase(),
    change_kind: 'syntax_repair',
  })
  submitPrompt('syntax_repair', repairText)
}

function handleRequestedSyntaxRepair() {
  const requestId = props.syntaxRepairRequestId
  if (!props.open || !requestId || requestId === lastHandledSyntaxRepairRequestId.value) return
  lastHandledSyntaxRepairRequestId.value = requestId
  repairSyntax()
}

function toggleCode() {
  trackAnalyticsEvent('ai_chat_code_visibility_toggled', {
    ...analyticsBase(),
    interaction_state: props.codeVisible ? 'hidden' : 'shown',
  })
  emit('toggle-code')
}

function closePanel() {
  expandedDiffMessageId.value = null
  historyOpen.value = false
  syntaxDetailsOpen.value = false
  emit('close')
}

function handleEscape() {
  if (expandedDiffPreview.value) {
    closeExpandedDiff()
    return
  }
  if (historyOpen.value) {
    closeHistory()
    return
  }
  if (syntaxDetailsOpen.value) {
    syntaxDetailsOpen.value = false
    return
  }
  closePanel()
}

async function scrollToBottom() {
  await nextTick()
  if (messageList.value) {
    messageList.value.scrollTop = messageList.value.scrollHeight
  }
}

watch([messages, isThinking, stageIndex], scrollToBottom, { deep: true })
watch(
  () => props.syntaxError,
  () => {
    syntaxResolved.value = false
    syntaxDetailsOpen.value = false
  },
)
watch(
  () => props.currentCode,
  (code) => {
    if (versions.value.length === 1) {
      versions.value[0].code = code
    }
  },
)
watch(
  () => props.diagramlyDiagramId,
  (diagramId) => {
    if (diagramId && diagramId !== activeDiagramlyDiagramId.value) {
      activeDiagramlyDiagramId.value = diagramId
      persistedVersionsStatus.value = 'idle'
      if (props.open) loadPersistedVersions()
    }
  },
)
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      focusInput()
      loadPersistedVersions()
    }
  },
  { immediate: true },
)
watch(() => props.syntaxRepairRequestId, handleRequestedSyntaxRepair, { immediate: true })
watch(() => props.open, handleRequestedSyntaxRepair)

onBeforeUnmount(() => {
  activeRequestId.value += 1
  clearTimers()
})
</script>

<style src="@/assets/ai-chat.css"></style>
