<template>
  <aside
    v-if="open"
    class="ai-chat-panel"
    aria-label="AI diagram assistant"
    data-testid="ai-chat-panel"
    @keydown.esc="handleEscape"
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
            @click="toggleCode"
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
          :disabled="isBusy"
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
            <div class="ai-chat-preview-header">
              <strong>{{ message.preview.title }}</strong>
              <button
                v-if="message.preview.previousVersionId"
                type="button"
                data-testid="ai-chat-undo"
                :disabled="isBusy"
                @click="undoPreview(message.preview)"
              >
                {{ restoringAction === 'undo' ? 'Undoing...' : 'Undo' }}
              </button>
            </div>
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
                <span>
                  <strong>Code diff</strong>
                  <span>{{ message.preview.diffLocation }}</span>
                </span>
                <button
                  type="button"
                  aria-label="Expand code diff"
                  data-testid="ai-chat-diff-expand"
                  @click="openExpandedDiff(message.id)"
                >
                  Expand
                </button>
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
          v-if="isBusy"
          class="ai-chat-progress"
          role="status"
          aria-live="polite"
          data-testid="ai-chat-thinking"
        >
          <p v-if="isRestoringVersion">Restoring version...</p>
          <ol v-else>
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
        <header>
          <span>
            <strong>Code diff</strong>
            <span>{{ expandedDiffPreview.diffLocation }}</span>
          </span>
          <button
            type="button"
            aria-label="Close expanded code diff"
            data-testid="ai-chat-diff-fullscreen-close"
            @click="closeExpandedDiff"
          >
            Close
          </button>
        </header>
        <div class="ai-chat-diff-code">
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
      <header>
        <h3>Diagram versions</h3>
        <button type="button" aria-label="Close diagram versions" @click="closeHistory">
          Close
        </button>
      </header>
      <div
        v-if="versionsStatus === 'loading'"
        role="status"
        data-testid="ai-chat-history-loading"
      >
        Loading saved versions...
      </div>
      <div
        v-else-if="versionsStatus === 'failed'"
        role="status"
        data-testid="ai-chat-history-error"
      >
        <p>Saved versions could not be loaded.</p>
        <button type="button" data-testid="ai-chat-history-retry" @click="retryLoadVersions">
          Retry
        </button>
      </div>
      <p v-else-if="reversedVersions.length === 0">No saved versions yet.</p>
      <ol v-else class="ai-chat-history-list">
        <li
          v-for="version in reversedVersions"
          :key="version.id"
          class="ai-chat-history-item"
          :class="{ 'is-current': version.id === activeVersionId }"
        >
          <div>
            <p>
              <strong>v{{ version.versionNumber }}</strong>
              <span>{{ version.summary }}</span>
            </p>
            <p>{{ version.detail }}</p>
            <small>{{ version.time }}</small>
          </div>
          <button
            type="button"
            class="ai-chat-rollback"
            :disabled="version.id === activeVersionId || isBusy"
            @click="restoreVersion(version)"
          >
            {{
              version.id === activeVersionId
                ? 'Current'
                : restoringVersionId === version.id
                  ? 'Restoring...'
                  : 'Restore version'
            }}
          </button>
        </li>
      </ol>
    </section>

    <form class="ai-chat-composer" @submit.prevent="submitPrompt()">
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
      <button
        type="button"
        aria-label="Open diagram versions"
        data-testid="ai-chat-history-trigger"
        :aria-expanded="historyOpen"
        :disabled="!activeDiagramId"
        @click="openHistory"
      >
        Diagram versions
        <span>{{ versionCountLabel }}</span>
      </button>
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
  buildDiffLines,
  createCodePreview,
  formatVersionTime,
  type AIChatChangePreview,
  type AIChatChangeKind,
  type AIChatMessage,
  type AIChatSuggestion,
  type AIChatVersion,
} from './aiChatPrototype'
import {
  runAIChatSession,
  type AIChatSessionStage,
} from '@/services/AIChatSessionService'
import {
  getDiagramlyVersions,
  restoreDiagramlyVersion,
  type DiagramlyVersion,
} from '@/services/GenerateService'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { MacroTypeValue } from '@/utils/analytics/catalog'

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
const isRestoringVersion = ref(false)
const activeStage = ref<AIChatSessionStage | null>(null)
const openDiffIds = ref<string[]>([])
const expandedDiffMessageId = ref<string | null>(null)
const historyOpen = ref(false)
const activeDiagramId = ref(props.diagramlyDiagramId.trim())
const activeCode = ref(props.currentCode)
const activeVersionId = ref('')
const versions = ref<AIChatVersion[]>([])
const versionsStatus = ref<'idle' | 'loading' | 'loaded' | 'failed'>('idle')
const versionsDiagramId = ref('')
const restoringVersionId = ref('')
const restoringAction = ref<'undo' | 'rollback' | null>(null)
const syntaxResolved = ref(false)
const lastHandledSyntaxRepairRequestId = ref(0)
let activeController: AbortController | null = null
let versionsRequestSequence = 0
let restoreRequestSequence = 0
let versionLoadPromise: Promise<void> | null = null
let messageSequence = 0

const isBusy = computed(() => isThinking.value || isRestoringVersion.value)
const canSubmit = computed(() => prompt.value.trim().length > 0 && !isBusy.value)
const visibleSyntaxError = computed(() => Boolean(props.syntaxError) && !syntaxResolved.value)
const syntaxErrorSummary = computed(() => props.syntaxError.split('\n')[0])
const activeStageIndex = computed(() => stages.findIndex((stage) => stage.key === activeStage.value))
const reversedVersions = computed(() => [...versions.value].sort(
  (first, second) => second.versionNumber - first.versionNumber,
))
const versionCountLabel = computed(() => {
  if (versionsStatus.value === 'loading') return '...'
  if (versionsStatus.value === 'failed') return '!'
  return String(versions.value.length)
})
const expandedDiffPreview = computed(() => messages.value.find(
  (message) => message.id === expandedDiffMessageId.value,
)?.preview || null)
const diagramTypeLabel = computed(() => {
  const labels: Record<string, string> = {
    sequence: 'Sequence',
    mermaid: 'Mermaid',
    plantuml: 'PlantUML',
    openapi: 'OpenAPI',
  }
  return labels[props.diagramType.toLowerCase()] || 'Current'
})
const macroType = computed<MacroTypeValue>(() => {
  const value = props.diagramType.toLowerCase()
  const supported: MacroTypeValue[] = [
    'sequence',
    'mermaid',
    'graph',
    'openapi',
    'embed',
    'plantuml',
  ]
  return supported.includes(value as MacroTypeValue)
    ? value as MacroTypeValue
    : 'none'
})

function analyticsBase() {
  return {
    feature_area: 'ai' as const,
    surface: 'editor' as const,
    macro_type: macroType.value,
  }
}

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

function toAIChatVersion(version: DiagramlyVersion): AIChatVersion {
  const instruction = version.instruction?.trim()
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    summary: version.versionNumber === 1
      ? 'Initial version'
      : instruction || version.title || `Version ${version.versionNumber}`,
    detail: version.comment || (instruction
      ? `Created from: ${instruction}`
      : `Saved Diagramly version ${version.versionNumber}.`),
    syntaxResolved: true,
    time: formatVersionTime(version.createdAt),
    code: version.content?.code,
  }
}

function nextVersionNumber(): number {
  return Math.max(0, ...versions.value.map((version) => version.versionNumber)) + 1
}

function upsertVersion(version: AIChatVersion): void {
  const existingIndex = versions.value.findIndex((item) => item.id === version.id)
  if (existingIndex >= 0) {
    versions.value.splice(existingIndex, 1, version)
    return
  }
  versions.value.push(version)
}

async function loadPersistedVersions(
  diagramId = activeDiagramId.value,
  force = false,
): Promise<void> {
  if (!diagramId) {
    versions.value = []
    versionsStatus.value = 'loaded'
    versionsDiagramId.value = ''
    activeVersionId.value = ''
    return
  }
  if (!force && versionsDiagramId.value === diagramId) {
    if (versionsStatus.value === 'loaded') return
    if (versionsStatus.value === 'loading' && versionLoadPromise) {
      await versionLoadPromise
      return
    }
  }

  const requestId = ++versionsRequestSequence
  versionsDiagramId.value = diagramId
  versionsStatus.value = 'loading'
  const request = (async () => {
    try {
      const result = await getDiagramlyVersions(diagramId)
      if (requestId !== versionsRequestSequence || activeDiagramId.value !== diagramId) return

      versions.value = [...(result.versions || [])]
        .sort((first, second) => first.versionNumber - second.versionNumber)
        .map(toAIChatVersion)
      const currentVersionId = result.diagram?.currentVersionId
      activeVersionId.value = currentVersionId
        || versions.value[versions.value.length - 1]?.id
        || ''
      versionsStatus.value = 'loaded'
    } catch {
      if (requestId === versionsRequestSequence && activeDiagramId.value === diagramId) {
        versionsStatus.value = 'failed'
      }
    }
  })()

  versionLoadPromise = request
  await request
  if (versionLoadPromise === request) versionLoadPromise = null
}

function retryLoadVersions(): void {
  void loadPersistedVersions(activeDiagramId.value, true)
}

function selectSuggestion(suggestion: AIChatSuggestion): void {
  prompt.value = suggestion.label
  trackAnalyticsEvent('ai_chat_suggestion_selected', {
    ...analyticsBase(),
    suggestion_id: suggestion.id,
  })
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

function openExpandedDiff(messageId: string): void {
  const message = messages.value.find((item) => item.id === messageId)
  if (!message?.preview) return
  expandedDiffMessageId.value = messageId
  historyOpen.value = false
  trackAnalyticsEvent('ai_chat_diff_toggled', {
    ...analyticsBase(),
    interaction_state: 'shown',
    ui_component: 'code_diff_fullscreen',
  })
}

function closeExpandedDiff(): void {
  if (!expandedDiffMessageId.value) return
  expandedDiffMessageId.value = null
  trackAnalyticsEvent('ai_chat_diff_toggled', {
    ...analyticsBase(),
    interaction_state: 'hidden',
    ui_component: 'code_diff_fullscreen',
  })
}

function openHistory(): void {
  if (!activeDiagramId.value) return
  expandedDiffMessageId.value = null
  historyOpen.value = true
  trackAnalyticsEvent('ai_chat_history_opened', {
    ...analyticsBase(),
    version_id: activeVersionId.value,
  })
  if (versionsStatus.value === 'idle') {
    void loadPersistedVersions(activeDiagramId.value)
  }
}

function closeHistory(): void {
  historyOpen.value = false
}

function cancelActiveRequest(): void {
  activeController?.abort()
  activeController = null
  restoreRequestSequence += 1
  isThinking.value = false
  isRestoringVersion.value = false
  restoringVersionId.value = ''
  restoringAction.value = null
  activeStage.value = null
}

function closePanel(): void {
  cancelActiveRequest()
  closeExpandedDiff()
  closeHistory()
  emit('close')
}

function toggleCode(): void {
  trackAnalyticsEvent('ai_chat_code_visibility_toggled', {
    ...analyticsBase(),
    interaction_state: props.codeVisible ? 'hidden' : 'shown',
  })
  emit('toggle-code')
}

function handleEscape(): void {
  if (expandedDiffMessageId.value) {
    closeExpandedDiff()
    return
  }
  if (historyOpen.value) {
    closeHistory()
    return
  }
  closePanel()
}

function repairSyntax(): void {
  if (isBusy.value) return
  trackAnalyticsEvent('ai_chat_syntax_repair_requested', {
    ...analyticsBase(),
    change_kind: 'syntax_repair',
  })
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
  if (!text || isBusy.value) return false

  const previousCode = activeCode.value
  const controller = new AbortController()
  activeController = controller
  isThinking.value = true
  activeStage.value = activeDiagramId.value ? 'queued' : 'ensuring'
  messages.value.push({ id: nextMessageId('user'), role: 'user', text })
  prompt.value = ''
  trackAnalyticsEvent('ai_chat_prompt_submitted', {
    ...analyticsBase(),
    generation_source: kind === 'syntax_repair' ? 'syntax_repair' : 'chat_panel',
    prompt_length: text.length,
    chat_message_count: messages.value.length,
    change_kind: kind,
  })
  emit('send', text)

  try {
    if (activeDiagramId.value && versionsStatus.value !== 'loaded') {
      await loadPersistedVersions(activeDiagramId.value)
      if (controller.signal.aborted) return false
    }

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
        await loadPersistedVersions(diagramId, true)
      },
    })
    if (activeController !== controller) return false

    const previousVersionId = activeVersionId.value
    activeDiagramId.value = result.diagramId
    activeCode.value = result.updatedCode
    activeVersionId.value = result.versionId
    upsertVersion({
      id: result.versionId,
      versionNumber: result.versionNumber || nextVersionNumber(),
      summary: kind === 'syntax_repair' ? 'Fixed syntax issue' : text,
      detail: kind === 'syntax_repair'
        ? 'Corrected the syntax issue through AI Chat.'
        : `Created from: ${text}`,
      syntaxResolved: kind === 'syntax_repair' || !props.syntaxError,
      time: result.createdAt ? formatVersionTime(result.createdAt) : formatVersionTime(),
      code: result.updatedCode,
    })
    if (versionsStatus.value !== 'failed') versionsStatus.value = 'loaded'
    const preview = createCodePreview(
      diagramTypeLabel.value,
      kind,
      previousCode,
      result.updatedCode,
    )
    preview.versionId = result.versionId
    preview.previousVersionId = previousVersionId && previousVersionId !== result.versionId
      ? previousVersionId
      : undefined

    const message: AIChatMessage = {
      id: nextMessageId('assistant'),
      role: 'assistant',
      text: '',
      preview,
    }
    messages.value.push(message)
    if (kind === 'syntax_repair') syntaxResolved.value = true
    trackAnalyticsEvent('ai_chat_change_applied', {
      ...analyticsBase(),
      chat_message_count: messages.value.length,
      change_kind: kind,
      version_id: result.versionId,
    })
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

async function undoPreview(preview: AIChatChangePreview): Promise<void> {
  const targetVersionId = preview.previousVersionId
  if (!targetVersionId) return

  const restored = await restoreTargetVersion(targetVersionId, 'undo')
  if (restored) preview.previousVersionId = undefined
}

function restoreVersion(version: AIChatVersion): void {
  if (version.id === activeVersionId.value) return
  void restoreTargetVersion(version.id, 'rollback')
}

async function restoreTargetVersion(
  targetVersionId: string,
  kind: 'undo' | 'rollback',
): Promise<boolean> {
  if (!activeDiagramId.value || isBusy.value) return false

  const requestId = ++restoreRequestSequence
  const previousCode = activeCode.value
  const targetVersion = versions.value.find((version) => version.id === targetVersionId)
  isRestoringVersion.value = true
  restoringVersionId.value = targetVersionId
  restoringAction.value = kind

  try {
    const result = await restoreDiagramlyVersion(activeDiagramId.value, targetVersionId)
    if (requestId !== restoreRequestSequence) return false

    const restoredVersion = toAIChatVersion(result.version)
    const restoredCode = result.diagramCode ?? result.version.content?.code ?? ''
    if (!restoredCode) throw new Error('Diagramly restored a version without diagram code')

    activeCode.value = restoredCode
    activeVersionId.value = restoredVersion.id
    upsertVersion({ ...restoredVersion, code: restoredCode })
    versionsStatus.value = 'loaded'

    const message: AIChatMessage = {
      id: nextMessageId('assistant'),
      role: 'assistant',
      text: '',
      preview: {
        title: kind === 'undo' ? 'Changes undone' : 'Version restored',
        kind,
        versionId: restoredVersion.id,
        updatedCode: restoredCode,
        items: [
          `Restored v${targetVersion?.versionNumber || '?'} and saved it as v${restoredVersion.versionNumber}.`,
        ],
        diffLocation: `${diagramTypeLabel.value} diagram`,
        diffLines: buildDiffLines(previousCode, restoredCode),
      },
    }
    messages.value.push(message)
    historyOpen.value = false
    trackAnalyticsEvent(
      kind === 'undo' ? 'ai_chat_change_undone' : 'ai_chat_version_restored',
      {
        ...analyticsBase(),
        change_kind: kind,
        version_id: targetVersionId,
      },
    )
    emit('apply-code', restoredCode)
    emit('apply', message)
    return true
  } catch (error) {
    if (requestId !== restoreRequestSequence) return false
    const detail = error instanceof Error ? error.message : 'Unknown error'
    messages.value.push({
      id: nextMessageId('assistant'),
      role: 'assistant',
      text: `AI Chat could not restore the version: ${detail}`,
    })
    return false
  } finally {
    if (requestId === restoreRequestSequence) {
      isRestoringVersion.value = false
      restoringVersionId.value = ''
      restoringAction.value = null
    }
  }
}

watch(
  () => props.diagramlyDiagramId,
  (diagramId) => {
    const normalizedDiagramId = diagramId.trim()
    if (normalizedDiagramId !== activeDiagramId.value && !isBusy.value) {
      activeDiagramId.value = normalizedDiagramId
      activeVersionId.value = ''
      versions.value = []
      versionsStatus.value = 'idle'
      versionsDiagramId.value = ''
    }
    if (props.open && activeDiagramId.value && versionsStatus.value === 'idle') {
      void loadPersistedVersions(activeDiagramId.value)
    }
  },
  { immediate: true },
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
  [() => props.syntaxRepairRequestId, () => props.open, isBusy],
  ([requestId, open, busy]) => {
    if (
      !open ||
      !requestId ||
      requestId === lastHandledSyntaxRepairRequestId.value ||
      !props.syntaxError ||
      busy
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
    if (!open) {
      cancelActiveRequest()
      closeExpandedDiff()
      closeHistory()
      return
    }
    if (activeDiagramId.value && versionsStatus.value === 'idle') {
      void loadPersistedVersions(activeDiagramId.value)
    }
  },
)

onBeforeUnmount(() => {
  versionsRequestSequence += 1
  cancelActiveRequest()
})
</script>
