<script setup lang="ts">
/**
 * The ZenUML Agent Panel: TemPad Dev's floating panel (MIT) transcribed from
 * the reference prototype — App.vue header and MCP badge, Panel.vue drag /
 * resize / minimise, DesignTaskStatus.vue task row, PrefSection.vue (Agent
 * integration only), MetaSection.vue (current PR instead of the selected
 * layer). Review and Messages sections are additions built from the same
 * classes. Class names are TemPad's `tp-*`.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { PrRef, PrState, ReviewSummary, Task } from '@zenuml/pr-panel-shared'
import { MAX_MESSAGE_LENGTH } from '@zenuml/pr-panel-shared'
import { LOGO_KEYFRAMES_CSS, MINUS, PLUS, PREFERENCES, TICK, pathAt } from './icons'
import { PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, type PanelPosition } from '../state/prefs'
import type { PanelConnection, PanelMessageView, PanelPrefsView } from './types'

const props = withDefaults(
  defineProps<{
    connection: PanelConnection
    task?: Task | null
    pr?: PrRef | null
    prState?: PrState
    review?: ReviewSummary | null
    /** Number of findings in the latest review, when known (the list summary does not carry it). */
    findingsCount?: number | null
    messages?: PanelMessageView[]
    prefs: PanelPrefsView
  }>(),
  { task: null, pr: null, prState: 'unknown', review: null, findingsCount: null, messages: () => [] },
)

const emit = defineEmits<{
  activate: []
  stop: [taskId: string]
  done: [taskId: string]
  send: [text: string]
  toggleCollapsed: []
  togglePrefs: []
  setMcpAccess: [value: 'enabled' | 'disabled']
  openOptions: []
  resize: [width: number]
  move: [position: PanelPosition]
}>()

const LOGO_D = pathAt(0)
const minimized = computed(() => props.prefs.panelCollapsed)
const prefOpen = computed(() => !props.prefs.preferencesHidden)

// ---- App.vue: badge tone / variant / tooltip / classes
const connected = computed(() => props.connection !== 'off')
const active = computed(() => props.connection === 'active')
const badgeClass = computed(() => [
  'tp-badge',
  'tp-mcp-badge',
  `tp-badge-${active.value ? 'success' : 'neutral'}`,
  `tp-badge-${active.value ? 'solid' : 'dashed'}`,
  `tp-mcp-badge-${connected.value ? 'connected' : 'disconnected'}`,
  ...(connected.value ? [active.value ? 'tp-mcp-badge-active' : 'tp-mcp-badge-inactive'] : []),
])
const badgeTitle = computed(() => {
  if (!connected.value) return props.prefs.mcpAccess === 'disabled' ? 'MCP access is disabled' : 'MCP server is not running'
  return active.value ? 'Active' : 'Inactive\nClick to activate'
})
function onBadge() {
  if (props.connection === 'inactive') emit('activate')
}

// ---- DesignTaskStatus.vue: working → shimmer label + Stop; ended → plain label + Done
const AGENT_NAMES = { claude_code: 'Claude Code', codex: 'Codex', other: 'The agent' } as const
const agentName = computed(() => (props.task ? AGENT_NAMES[props.task.agent.kind] : 'The agent'))
const taskWorking = computed(() => props.task?.status === 'working')
const taskLabel = computed(() => {
  const t = props.task
  if (!t) return ''
  const noun = t.kind === 'review' ? 'review' : 'task'
  switch (t.status) {
    case 'working':
      return t.label?.trim() || `${agentName.value} is working on the ${noun}`
    case 'finished':
      return `${agentName.value} finished the ${noun}`
    case 'failed':
      return `${agentName.value} could not finish the ${noun}`
    case 'cancelled':
      return `${agentName.value} stopped the ${noun}`
    default:
      return ''
  }
})

// ---- MetaSection.vue: the current PR (click to copy) + PR state badge
const prLabel = computed(() => (props.pr ? `#${props.pr.number}${props.pr.title ? ` · ${props.pr.title}` : ''}` : ''))
const STATE_BADGE: Record<PrState, { text: string; tone: string } | null> = {
  open: { text: 'Open', tone: 'success' },
  draft: { text: 'Draft', tone: 'neutral' },
  merged: { text: 'Merged', tone: 'brand' },
  closed: { text: 'Closed', tone: 'danger' },
  unknown: null,
}
const stateBadge = computed(() => STATE_BADGE[props.prState])
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
async function copyPr() {
  if (!props.pr) return
  try {
    await navigator.clipboard.writeText(prLabel.value)
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1200)
  } catch {
    // Clipboard can be blocked by the page's permissions policy; nothing to do.
  }
}

// The broker may refuse "Enabled" (no host permission yet) and open the options page instead.
// The prop then does not change, so put the native radios back to what the prefs say.
function onMcpChange(value: 'enabled' | 'disabled', e: Event) {
  emit('setMcpAccess', value)
  const group = (e.target as HTMLElement).closest('[role="radiogroup"]')
  void nextTick(() => {
    group?.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((input) => {
      input.checked = input.dataset.value === props.prefs.mcpAccess
    })
  })
}

// ---- Review section
const PRIORITY_TONE = { P1: 'danger', P2: 'warning', P3: 'neutral' } as const

// ---- Messages section
const draft = ref('')
// The Hub rejects a longer message, and the broker would drop it without a reply, leaving the row on "sending".
const canSend = computed(() => connected.value && draft.value.trim().length > 0 && draft.value.trim().length <= MAX_MESSAGE_LENGTH)
function send() {
  const text = draft.value.trim()
  if (!text || !connected.value || text.length > MAX_MESSAGE_LENGTH) return
  emit('send', text)
  draft.value = ''
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}
const STATUS_TEXT = { sending: 'sending', queued: 'queued', delivered: 'delivered' } as const

// ---- Panel.vue: drag by header, double-click header toggles minimised,
// resize from either edge (240–500), double-click an edge resets to 240.
// Anchored bottom-right, so position is an offset from that corner.
const panelEl = ref<HTMLElement | null>(null)
const width = ref(props.prefs.panelWidth || PANEL_DEFAULT_WIDTH)
const pos = ref<PanelPosition>(props.prefs.panelPosition ?? { right: 24, bottom: 24 })
const dragging = ref(false)
const panelStyle = computed(() => ({ width: `${width.value}px`, right: `${pos.value.right}px`, bottom: `${pos.value.bottom}px` }))

// Prefs load asynchronously and can change in another tab; follow them unless a gesture is in progress.
watch(
  () => props.prefs.panelWidth,
  (w) => {
    if (!rs && w) width.value = w
  },
)
watch(
  () => props.prefs.panelPosition,
  (p) => {
    if (!drag && !rs) pos.value = p ?? { right: 24, bottom: 24 }
  },
)

let drag: { x: number; y: number; right: number; bottom: number } | null = null
let rs: { dir: 'left' | 'right'; x: number; w: number; right: number } | null = null
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function isControl(e: Event) {
  return !!(e.target as Element | null)?.closest?.('button,.tp-badge')
}
function onHeaderDblClick(e: MouseEvent) {
  if (isControl(e)) return
  emit('toggleCollapsed')
}
function onHeaderPointerDown(e: PointerEvent) {
  if (isControl(e) || e.button !== 0) return
  drag = { x: e.clientX, y: e.clientY, right: pos.value.right, bottom: pos.value.bottom }
  dragging.value = true
  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
}
function onHeaderPointerMove(e: PointerEvent) {
  if (!drag) return
  const w = width.value
  const vw = window.innerWidth
  const vh = window.innerHeight
  pos.value = {
    right: clamp(drag.right - (e.clientX - drag.x), -w / 2, vw - w / 2),
    bottom: clamp(drag.bottom - (e.clientY - drag.y), 12, vh - 41 - 12),
  }
}
function onHeaderPointerUp() {
  if (!drag) return
  const moved = drag.right !== pos.value.right || drag.bottom !== pos.value.bottom
  drag = null
  dragging.value = false
  if (moved) emit('move', { ...pos.value })
}
function onResizeDown(dir: 'left' | 'right', e: PointerEvent) {
  e.preventDefault()
  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  rs = { dir, x: e.clientX, w: width.value, right: pos.value.right }
}
function onResizeMove(e: PointerEvent) {
  if (!rs) return
  const dx = e.clientX - rs.x
  const w = clamp(rs.dir === 'right' ? rs.w + dx : rs.w - dx, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)
  width.value = w
  if (rs.dir === 'right') pos.value = { ...pos.value, right: rs.right - (w - rs.w) }
}
function onResizeUp() {
  if (!rs) return
  rs = null
  emit('resize', width.value)
  emit('move', { ...pos.value })
}
function onResizeReset(dir: 'left' | 'right') {
  const w = width.value
  width.value = PANEL_DEFAULT_WIDTH
  if (dir === 'right') pos.value = { ...pos.value, right: pos.value.right + (w - PANEL_DEFAULT_WIDTH) }
  emit('resize', PANEL_DEFAULT_WIDTH)
  emit('move', { ...pos.value })
}

onBeforeUnmount(() => clearTimeout(copiedTimer))
</script>

<template>
  <div class="tempad">
    <component :is="'style'">{{ LOGO_KEYFRAMES_CSS }}</component>
    <article
      ref="panelEl"
      class="tp-panel tp-main"
      :class="{ 'tp-panel-minimized': minimized, 'tp-panel-dragging': dragging }"
      :style="panelStyle"
      aria-label="ZenUML panel"
    >
      <div
        class="tp-panel-resize-handle tp-panel-resize-handle-left"
        data-dir="left"
        @pointerdown="onResizeDown('left', $event)"
        @pointermove="onResizeMove"
        @pointerup="onResizeUp"
        @pointercancel="onResizeUp"
        @dblclick="onResizeReset('left')"
      ></div>
      <div
        class="tp-panel-resize-handle tp-panel-resize-handle-right"
        data-dir="right"
        @pointerdown="onResizeDown('right', $event)"
        @pointermove="onResizeMove"
        @pointerup="onResizeUp"
        @pointercancel="onResizeUp"
        @dblclick="onResizeReset('right')"
      ></div>
      <div class="tp-panel-wrapper">
        <header
          class="tp-row tp-row-justify tp-panel-header"
          @dblclick="onHeaderDblClick"
          @pointerdown="onHeaderPointerDown"
          @pointermove="onHeaderPointerMove"
          @pointerup="onHeaderPointerUp"
          @pointercancel="onHeaderPointerUp"
        >
          <div class="tp-row tp-gap-l">
            <span>ZenUML</span>
            <div
              :class="badgeClass"
              :title="badgeTitle"
              role="button"
              tabindex="0"
              data-testid="mcp-badge"
              @click="onBadge"
              @keydown.enter.prevent="onBadge"
              @keydown.space.prevent="onBadge"
            >
              <span class="tp-mcp-dot"></span>MCP
            </div>
          </div>
          <div class="tp-row tp-gap-l">
            <button
              v-if="!minimized"
              class="tp-button"
              :class="{ 'tp-button-selected': prefOpen }"
              type="button"
              aria-label="Preferences"
              :aria-pressed="prefOpen"
              title="Preferences"
              data-testid="prefs-button"
              @click="emit('togglePrefs')"
              v-html="PREFERENCES"
            ></button>
            <button
              class="tp-button"
              type="button"
              :aria-label="minimized ? 'Expand' : 'Minimise'"
              :title="minimized ? 'Expand' : 'Minimise'"
              data-testid="collapse-button"
              @click="emit('toggleCollapsed')"
              v-html="minimized ? PLUS : MINUS"
            ></button>
          </div>
        </header>

        <main v-if="!minimized" class="tp-panel-main">
          <!-- DesignTaskStatus.vue -->
          <section v-if="task" class="tp-section tp-section-flat tp-design-task-section" data-testid="task-row">
            <div class="tp-section-content">
              <div class="tp-design-panel-status">
                <svg
                  class="tp-design-logo"
                  :class="{ 'tp-logo-loading': taskWorking }"
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 512 512"
                  aria-hidden="true"
                >
                  <g transform="translate(256 256) scale(.88) translate(-256 -320)">
                    <path class="tp-logo-plane" fill="#7F61E4" transform="translate(-10 0)" :d="LOGO_D" />
                    <path class="tp-logo-plane" fill="#3077EC" transform="translate(10 0) rotate(180 256 320)" :d="LOGO_D" />
                  </g>
                </svg>
                <span class="tp-design-locate" :title="taskLabel">
                  <span :class="{ 'tp-design-shimmer': taskWorking }" data-testid="task-label">{{ taskLabel }}</span>
                </span>
                <div class="tp-design-panel-actions">
                  <button
                    v-if="taskWorking"
                    type="button"
                    class="tp-action-button tp-action-button-secondary tp-design-stop"
                    title="Stop the agent's task"
                    data-testid="task-action"
                    @click="emit('stop', task.taskId)"
                  >Stop</button>
                  <button
                    v-else
                    type="button"
                    class="tp-action-button tp-action-button-secondary tp-design-done"
                    title="Dismiss the finished task"
                    data-testid="task-action"
                    @click="emit('done', task.taskId)"
                  >Done</button>
                </div>
              </div>
            </div>
          </section>

          <!-- PrefSection.vue: only AgentIntegrationSection is kept -->
          <section v-if="prefOpen" class="tp-section tp-pref" data-testid="prefs-section">
            <div class="tp-section-content">
              <section class="tp-section tp-section-flat tp-agent-integration tp-pref-agent-integration">
                <header class="tp-row tp-row-justify tp-gap-l tp-section-header"><div class="tp-row">Agent integration</div></header>
                <div class="tp-section-content">
                  <div class="tp-grid tp-grid-2">
                    <label>MCP access</label>
                    <div class="tp-segmented-control tp-grid-end" role="radiogroup" aria-label="MCP access">
                      <div class="tp-segmented-control-option">
                        <input
                          id="tp-mcp-off"
                          type="radio"
                          class="tp-segmented-control-input"
                          name="tp-mcp"
                          title="Disabled"
                          data-testid="mcp-off"
                          data-value="disabled"
                          :checked="prefs.mcpAccess === 'disabled'"
                          @change="onMcpChange('disabled', $event)"
                        />
                        <span class="tp-segmented-control-icon" aria-hidden="true" v-html="MINUS"></span>
                        <label for="tp-mcp-off" class="tp-segmented-control-label">Disabled</label>
                      </div>
                      <div class="tp-segmented-control-option">
                        <input
                          id="tp-mcp-on"
                          type="radio"
                          class="tp-segmented-control-input"
                          name="tp-mcp"
                          title="Enabled"
                          data-testid="mcp-on"
                          data-value="enabled"
                          :checked="prefs.mcpAccess === 'enabled'"
                          @change="onMcpChange('enabled', $event)"
                        />
                        <span class="tp-segmented-control-icon" aria-hidden="true" v-html="TICK"></span>
                        <label for="tp-mcp-on" class="tp-segmented-control-label">Enabled</label>
                      </div>
                    </div>
                  </div>
                  <div class="tp-grid">
                    <button
                      type="button"
                      class="tp-action-button tp-action-button-secondary tp-agent-setup-button"
                      data-testid="setup-agents"
                      @click="emit('openOptions')"
                    >Set up agents</button>
                  </div>
                </div>
              </section>
            </div>
          </section>

          <!-- MetaSection.vue -->
          <section class="tp-section tp-section-flat" data-testid="meta-row">
            <header class="tp-row tp-row-justify tp-gap-l tp-section-header">
              <span v-if="!pr" class="tp-meta-title-aux tp-ellipsis">No pull request</span>
              <div v-else class="tp-meta-title tp-row tp-shrink tp-gap-l">
                <div
                  class="tp-copyable tp-copyable-m tp-copyable-normal tp-ellipsis"
                  :title="copied ? 'Copied' : `Click to copy: ${prLabel}`"
                  data-testid="pr-label"
                  @click="copyPr"
                >{{ prLabel }}</div>
                <div v-if="stateBadge" class="tp-copyable tp-copyable-m tp-copyable-block">
                  <div class="tp-badge tp-badge-solid" :class="`tp-badge-${stateBadge.tone}`" :title="stateBadge.text">{{ stateBadge.text }}</div>
                </div>
              </div>
            </header>
          </section>

          <template v-if="pr">
            <!-- Review: latest completed AI review of this PR -->
            <section class="tp-section" data-testid="review-section">
              <header class="tp-row tp-row-justify tp-gap-l tp-section-header"><div class="tp-row">Review</div></header>
              <div class="tp-section-content">
                <div v-if="review" class="tp-review">
                  <div class="tp-review-headline">{{ review.headline }}</div>
                  <div class="tp-row tp-review-meta">
                    <div v-if="review.priority" class="tp-badge tp-badge-solid" :class="`tp-badge-${PRIORITY_TONE[review.priority]}`">{{ review.priority }}</div>
                    <span v-if="findingsCount != null">{{ findingsCount }} {{ findingsCount === 1 ? 'finding' : 'findings' }}</span>
                    <div v-if="review.stale" class="tp-badge tp-badge-neutral tp-badge-dashed" title="The PR changed after this review">PR updated</div>
                    <div v-if="review.conflict" class="tp-badge tp-badge-danger tp-badge-solid">Conflict</div>
                  </div>
                  <div v-if="review.summary" class="tp-review-summary">{{ review.summary }}</div>
                </div>
                <div v-else class="tp-review-empty">No review yet</div>
              </div>
            </section>

            <!-- Messages: agent messages above, one-line compose box below -->
            <section class="tp-section" data-testid="messages-section">
              <header class="tp-row tp-row-justify tp-gap-l tp-section-header"><div class="tp-row">Messages</div></header>
              <div class="tp-section-content tp-messages">
                <div v-if="messages.length" class="tp-message-list" role="log" aria-live="polite">
                  <div
                    v-for="m in messages"
                    :key="m.id"
                    class="tp-message"
                    :class="`tp-message-${m.role}`"
                    data-testid="message"
                  >
                    {{ m.text }}<span v-if="m.role === 'user' && m.status" class="tp-message-status" data-testid="message-status">{{ m.status === 'queued' && m.waitingForAgent ? "queued, delivered on the agent's next turn" : STATUS_TEXT[m.status] }}</span>
                  </div>
                </div>
                <div class="tp-message-compose">
                  <textarea
                    v-model="draft"
                    class="tp-message-input"
                    rows="1"
                    :maxlength="MAX_MESSAGE_LENGTH"
                    :placeholder="connected ? 'Message the agent' : 'Agent not connected'"
                    :disabled="!connected"
                    aria-label="Message the agent"
                    data-testid="message-input"
                    @keydown="onKeydown"
                  ></textarea>
                  <button
                    type="button"
                    class="tp-action-button tp-action-button-secondary"
                    :disabled="!canSend"
                    data-testid="send-button"
                    @click="send"
                  >Send</button>
                </div>
              </div>
            </section>
          </template>
        </main>
      </div>
    </article>
  </div>
</template>
