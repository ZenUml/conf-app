<template>
  <div class="agent-link-panel" :class="`agent-link-panel--${state}`" data-testid="agent-link-panel">
    <div class="agent-link-panel__scroll">
      <!-- Pairing is one handoff: copy the prompt, then the screen becomes a
           passive waiting state with no competing action. The 20s timeout
           keeps the same lifecycle instead of replacing it with a help wall. -->
      <template v-if="state === 'waiting' || state === 'timeout'">
        <div v-if="!pairingPromptCopied" data-testid="agent-link-pairing">
          <h3 class="agent-link-panel__heading">Connect</h3>

          <p class="agent-link-panel__intro">Copy this prompt into the AI assistant you are using.</p>

          <p v-if="lastAgentMemory" class="agent-link-panel__memory-cue" data-testid="agent-link-last-agent">
            Last connected with {{ lastAgentMemory.label }}.
          </p>

          <pre class="agent-link-panel__prompt" data-testid="agent-link-prompt">{{ promptText }}</pre>

          <button
            type="button"
            class="agent-link-panel__btn agent-link-panel__btn--primary"
            data-testid="agent-link-copy-prompt-btn"
            @click="onCopyPrompt"
          >{{ copyButtonLabel }}</button>

        </div>

        <div v-else class="agent-link-panel__quiet-state" data-testid="agent-link-waiting">
          <span class="agent-link-panel__pulse-dot" aria-hidden="true"></span>
          <h3 class="agent-link-panel__heading">Waiting for your AI assistant</h3>
          <p data-testid="agent-link-waiting-status">Keep this window open. The connection will start from the prompt you copied.</p>
          <SupportedClientCarousel />
        </div>
      </template>

      <!-- connected (active rail): status header · bound diagram · TTL meter ·
           thinking banner (op in flight) · activity feed. Verbatim copy from
           the design contract's string table. -->
      <template v-else-if="state === 'connected'">
        <div data-testid="agent-link-connected">
          <AgentStatusHeader
            :state="state"
            :thinking="thinking === 'thinking'"
            :client-name="clientName"
            :diagram-title="diagramTitle"
            :last-activity-at="lastActivityAt"
          />

          <div class="agent-link-panel__bound">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
            <span><span class="agent-link-panel__bound-lbl">Linked to</span> <b>{{ diagramTitle || 'this diagram' }}</b></span>
          </div>

          <SessionTtl :expires-at="expiresAt" :at-cap="atCap" />

          <!-- Thinking banner (Track F): shown while an update_diagram op is in
               flight; the elapsed hint appears after a few seconds so a long
               wait doesn't read as a hang. ArrowPath spin only, no skeletons. -->
          <div v-if="thinking === 'thinking'" class="agent-link-banner agent-link-banner--work" data-testid="agent-link-thinking-banner">
            <svg class="agent-link-banner__spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            <div class="agent-link-banner__body">
              <div class="agent-link-banner__title">Agent is editing…</div>
              <div class="agent-link-banner__sub">Applying changes to the diagram<span v-if="elapsedHint" class="agent-link-banner__elapsed"> {{ elapsedHint }}</span></div>
            </div>
          </div>

          <h4 class="agent-link-panel__feed-head">Activity</h4>
          <ul class="agent-link-panel__feed" data-testid="agent-link-activity-feed">
            <li
              v-for="(row, index) in feedRows"
              :key="`${row.at}-${index}`"
              class="agent-link-panel__feed-row"
              :class="{ 'agent-link-panel__feed-row--inflight': row.kind === 'inflight' }"
              data-testid="agent-link-activity-entry"
            >
              <span class="agent-link-panel__feed-ic" :class="`agent-link-panel__feed-ic--${row.tone}`" aria-hidden="true" v-html="row.icon"></span>
              <span class="agent-link-panel__feed-summary">{{ row.summary }}</span>
              <span class="agent-link-panel__feed-time">{{ formatTime(row.at) }}</span>
            </li>
            <li v-if="feedRows.length === 0" class="agent-link-panel__feed-empty">
              No edits yet — ask your agent to make a change.
            </li>
          </ul>

        </div>
      </template>

      <!-- Transient recovery stays non-blocking: the existing status header
           carries one amber connection indicator while the diagram remains
           usable. Details and actions appear only if recovery exhausts. -->
      <template v-else-if="state === 'suspended'">
        <div class="agent-link-panel__connection-status" data-testid="agent-link-automatic-recovery">
          <AgentStatusHeader
            :state="state"
            :client-name="clientName"
            :diagram-title="diagramTitle"
            :last-activity-at="lastActivityAt"
          />
        </div>
      </template>

      <template v-else-if="state === 'recovery_exhausted'">
        <div data-testid="agent-link-recovery-exhausted">
          <h3 class="agent-link-panel__heading">Connect</h3>
          <p class="agent-link-panel__intro">This connection ended. Copy this prompt into the AI assistant you are using.</p>
          <pre class="agent-link-panel__prompt" data-testid="agent-link-prompt">{{ promptText }}</pre>
          <button
            type="button"
            class="agent-link-panel__btn agent-link-panel__btn--primary"
            data-testid="agent-link-copy-prompt-btn"
            @click="onCopyPrompt"
          >{{ copyButtonLabel }}</button>
        </div>
      </template>

      <template v-else-if="state === 'incompatible'">
        <div class="agent-link-panel__quiet-state" data-testid="agent-link-incompatible">
          <h3 class="agent-link-panel__heading agent-link-panel__heading--warning">Your MCP needs an update</h3>
          <p>Nothing was changed. Update Agent Link MCP, then start a fresh AI assistant session.</p>
          <button
            type="button"
            class="agent-link-panel__btn agent-link-panel__btn--primary"
            data-testid="agent-link-protocol-help-btn"
            @click="onCopyProtocolHelp"
          >{{ protocolHelpButtonLabel }}</button>
        </div>
      </template>

      <template v-else-if="state === 'idle'">
        <div>
          <SessionNotice variant="idle" :diagram-title="diagramTitle" @reconnect="emit('reconnect')" />
        </div>
      </template>

      <!-- closed (Track G, terminal): explicit Disconnect. -->
      <template v-else-if="state === 'closed'">
        <div>
          <SessionNotice variant="closed" :diagram-title="diagramTitle" @reconnect="emit('reconnect')" />
        </div>
      </template>

      <!-- expired (#314, terminal): the client-side TTL watchdog noticed the
           minted token's own lapse (the relay already 403s the agent
           server-side). SessionNotice already ships an "expired" variant
           (verbatim design-contract copy) — reuse it and the SAME reconnect
           emit the closed/failed notices use, rather than inventing a new
           bridge. -->
      <template v-else-if="state === 'expired'">
        <div>
          <SessionNotice variant="expired" :diagram-title="diagramTitle" @reconnect="emit('reconnect')" />
        </div>
      </template>

      <!-- already_linked: mint rejected because another active session holds
           this diagram. Render the rejected notice instead of falling through
           to an empty rail. -->
      <template v-else-if="state === 'already_linked'">
        <SessionNotice
          variant="rejected"
          :diagram-title="diagramTitle"
          :lock-expires-at="lockExpiresAt"
          @revoke="emit('revoke')"
          @cancel="emit('cancel')"
        />
      </template>

      <!-- failed: generic mint failure. Keep it visible and retryable. -->
      <template v-else-if="state === 'failed'">
        <div>
          <SessionNotice variant="failed" :diagram-title="diagramTitle" @reconnect="emit('reconnect')" />
        </div>
      </template>

      <details
        v-if="showHelpDisclosure"
        class="agent-link-panel__disclosure"
        data-testid="agent-link-help-disclosure"
      >
        <summary>Need help?</summary>
        <div class="agent-link-panel__setup">
          <p>This is optional. Copy the help message, then paste it into the AI assistant you are using.</p>
          <button
            type="button"
            class="agent-link-panel__btn agent-link-panel__btn--secondary"
            data-testid="agent-link-setup-help-btn"
            @click="onCopySetupHelp"
          >{{ setupHelpButtonLabel }}</button>
        </div>
      </details>
    </div>

    <!-- Pinned footer actions for the active + suspended rail. Closed renders
         its own Reconnect CTA inside SessionNotice. -->
    <RailActions
      v-if="state === 'connected'"
      @disconnect="emit('disconnect')"
      @revoke="emit('revoke')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AgentLinkClientState, AgentLinkThinkingState } from '@/composables/agentLink/agentLinkState'
import type { AgentLinkActivityEntry } from '@/composables/agentLink/useAgentLinkSession'
import AgentStatusHeader from './AgentStatusHeader.vue'
import SupportedClientCarousel from './SupportedClientCarousel.vue'
import SessionTtl from './SessionTtl.vue'
import RailActions from './RailActions.vue'
import SessionNotice from './SessionNotice.vue'
import {
  AGENT_LINK_PROTOCOL_HELP_PROMPT,
  AGENT_LINK_SETUP_HELP_PROMPT,
} from './helpPrompts'
import {
  AGENT_LINK_CLIENT_MEMORY_EVENT,
  readAgentLinkClientMemory,
} from '@/composables/agentLink/clientMemory'

const props = withDefaults(
  defineProps<{
    state: AgentLinkClientState
    token: string | null
    activityFeed: AgentLinkActivityEntry[]
    // Track H additions — all optional so existing mounts (state/token/feed
    // only) render unchanged:
    //  - thinking: op-in-flight axis (Track F) → blue "Agent is editing…" banner
    //  - diagramTitle: names the bound diagram in the header/bound line
    //  - clientName: connected agent identity (falls back to "Connected agent")
    //  - expiresAt: absolute ms token expiry → TTL meter + resume countdown
    //  - lastActivityAt: newest agent signal → header/badge activity pulse
    thinking?: AgentLinkThinkingState
    diagramTitle?: string
    clientName?: string
    expiresAt?: number | null
    lastActivityAt?: number | null
    // Amendment D: absolute ms epoch when the existing lock on an
    // already-linked diagram releases — forwarded to the already_linked
    // SessionNotice for an honest countdown instead of a blind notice.
    lockExpiresAt?: number | null
    // Amendment F: the deadline is bound by the 60-min absolute cap —
    // forwarded to SessionTtl so it drops the "extends while your agent works"
    // hint once bumps no longer move the meter.
    atCap?: boolean
  }>(),
  { thinking: 'idle', diagramTitle: '', clientName: '', expiresAt: null, lastActivityAt: null, lockExpiresAt: null, atCap: false }
)

const emit = defineEmits<{
  (e: 'disconnect'): void
  // Track G: "Revoke & re-link" — closes the current session and immediately
  // mints a fresh one, in one click.
  (e: 'revoke'): void
  // Track H: "Reconnect" from the terminal (closed) notice — mints a fresh
  // session after an explicit disconnect / expiry.
  (e: 'reconnect'): void
  // Track H rejected notice secondary action. The host decides whether this
  // closes the Fullscreen surface or simply leaves the notice visible.
  (e: 'cancel'): void
}>()

const promptText = computed(() => {
  const sessionToken = props.token ?? ''
  return [
    'Connect this AI assistant to my ZenUML diagram through Agent Link.',
    `session: ${sessionToken}`,
    '# reads this page · edits this diagram · 10 min idle / 60 min max',
  ].join('\n')
})

type CopyState = 'default' | 'copied' | 'failed'
const copyState = ref<CopyState>('default')
const copiedHelp = ref<'setup' | 'protocol' | null>(null)
const pairingPromptCopied = ref(false)
let copyRevertTimer: ReturnType<typeof setTimeout> | null = null

const copyButtonLabel = computed(() => {
  if (copyState.value === 'copied') return '✓ Copied'
  if (copyState.value === 'failed') return 'Copy failed — select the text above'
  return 'Copy prompt'
})

const setupHelpButtonLabel = computed(() =>
  copiedHelp.value === 'setup' ? '✓ Copied — paste into your AI assistant' : 'Copy help message'
)
const protocolHelpButtonLabel = computed(() =>
  copiedHelp.value === 'protocol'
    ? '✓ Upgrade prompt copied'
    : 'Copy prompt to upgrade your MCP'
)

const showHelpDisclosure = computed(() => {
  if ((props.state === 'waiting' || props.state === 'timeout') && !pairingPromptCopied.value) return true
  return props.state === 'recovery_exhausted' || props.state === 'expired' || props.state === 'failed'
})

async function onCopyPrompt() {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(promptText.value)
      copyState.value = 'copied'
      pairingPromptCopied.value = true
      if (copyRevertTimer) clearTimeout(copyRevertTimer)
      copyRevertTimer = setTimeout(() => {
        copyState.value = 'default'
      }, 2000)
      return
    }
  } catch (e) {
    console.warn('[agent-link] failed to copy connect prompt', e)
  }
  copyState.value = 'failed'
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (e) {
    console.warn('[agent-link] failed to copy help prompt', e)
  }
  return false
}

async function onCopySetupHelp() {
  if (await copyText(AGENT_LINK_SETUP_HELP_PROMPT)) copiedHelp.value = 'setup'
}

async function onCopyProtocolHelp() {
  if (await copyText(AGENT_LINK_PROTOCOL_HELP_PROMPT)) copiedHelp.value = 'protocol'
}

watch(
  () => props.token,
  () => {
    pairingPromptCopied.value = false
    copyState.value = 'default'
  }
)

const lastAgentMemory = ref(readAgentLinkClientMemory())
function refreshLastAgentMemory() {
  lastAgentMemory.value = readAgentLinkClientMemory()
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', refreshLastAgentMemory)
  window.addEventListener(AGENT_LINK_CLIENT_MEMORY_EVENT, refreshLastAgentMemory)
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// --- Activity feed row typing -------------------------------------------------
// The composable stores plain summary strings; classify each into an icon tone
// so the feed reads like the design (ok / error / paused / resumed / in-flight)
// without changing the stored shape. Newest-last (chronological) — the store
// appends in order, so we render as-is (no reverse).
const ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M14.25 9v6m-4.5 0V9M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>',
  resume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"/></svg>',
  spin: '<svg class="agent-link-panel__feed-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>',
  // Track U discovery rows (design bundle preview/agent-link-fullscreen.html
  // feed-ic--muted): search = magnifying glass, read = eye, list = bullet list.
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>',
  read: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/></svg>',
} as const

interface FeedRow {
  summary: string
  at: number
  kind: 'normal' | 'inflight'
  tone: 'ok' | 'err' | 'warn' | 'work' | 'muted'
  icon: string
}

function classifyRow(entry: AgentLinkActivityEntry, isCurrentWork: boolean): FeedRow {
  const s = entry.summary
  if (s.startsWith('⚠')) return { ...entry, kind: 'normal', tone: 'err', icon: ICONS.error }
  if (s === 'Connection paused') return { ...entry, kind: 'normal', tone: 'warn', icon: ICONS.pause }
  if (s.startsWith('Connection restored')) return { ...entry, kind: 'normal', tone: 'ok', icon: ICONS.resume }
  // A working icon represents the current task only. The feed deliberately
  // retains prior "updating" rows as history, so inferring animation from the
  // row text alone leaves a spinner running after the task has settled.
  if (isCurrentWork && (s.includes('updating') || s.endsWith('…'))) {
    return { ...entry, kind: 'inflight', tone: 'work', icon: ICONS.spin }
  }
  // Track U discovery rows (read/search/list — composable's readDiagramFeedSummary/
  // searchFeedSummary/listFeedSummary). Muted tone: informational, not an outcome.
  if (s.startsWith('Searched ')) return { ...entry, kind: 'normal', tone: 'muted', icon: ICONS.search }
  if (s.startsWith('Read ')) return { ...entry, kind: 'normal', tone: 'muted', icon: ICONS.read }
  if (s.startsWith('Listed diagrams ')) return { ...entry, kind: 'normal', tone: 'muted', icon: ICONS.list }
  return { ...entry, kind: 'normal', tone: 'ok', icon: ICONS.check }
}

const feedRows = computed<FeedRow[]>(() =>
  props.activityFeed.map((entry, index) =>
    classifyRow(entry, props.thinking === 'thinking' && index === props.activityFeed.length - 1)
  )
)

// --- Thinking elapsed hint ("· 6s" after a few seconds) ----------------------
const ELAPSED_HINT_AFTER_SECONDS = 3
const thinkingElapsed = ref(0)
let thinkingTimer: ReturnType<typeof setInterval> | null = null
let thinkingStartedAt = 0

function stopThinkingTimer() {
  if (thinkingTimer !== null) {
    clearInterval(thinkingTimer)
    thinkingTimer = null
  }
}

watch(
  () => props.thinking,
  (t) => {
    if (t === 'thinking') {
      thinkingStartedAt = Date.now()
      thinkingElapsed.value = 0
      stopThinkingTimer()
      thinkingTimer = setInterval(() => {
        thinkingElapsed.value = Math.floor((Date.now() - thinkingStartedAt) / 1000)
      }, 1000)
    } else {
      stopThinkingTimer()
      thinkingElapsed.value = 0
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  stopThinkingTimer()
  if (copyRevertTimer) clearTimeout(copyRevertTimer)
  if (typeof window !== 'undefined') {
    window.removeEventListener('storage', refreshLastAgentMemory)
    window.removeEventListener(AGENT_LINK_CLIENT_MEMORY_EVENT, refreshLastAgentMemory)
  }
})

const elapsedHint = computed(() =>
  thinkingElapsed.value >= ELAPSED_HINT_AFTER_SECONDS ? `· ${thinkingElapsed.value}s` : ''
)

</script>

<style scoped>
.agent-link-panel {
  --agent-link-blue: #2563eb;
  --agent-link-blue-hover: #1d4ed8;
  --agent-link-green: #36b37e;
  --agent-link-amber: #8a6d00;
  --agent-link-ink: #172b4d;
  --agent-link-muted: #6b778c;
  --agent-link-faint: #97a0af;
  --agent-link-border: #e5e7eb;
  --agent-link-surface: #ffffff;
  --agent-link-surface-muted: #f7f8fa;

  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--agent-link-ink);
  background: var(--agent-link-surface);
  border: 1px solid transparent;
  box-sizing: border-box;
}

.agent-link-panel__scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* connected: subtle green live accent — asserted verbatim by ConnectPanel.spec */
.agent-link-panel--connected {
  border-color: var(--agent-link-green);
}

@media (prefers-color-scheme: dark) {
  .agent-link-panel {
    --agent-link-ink: #e6e8ee;
    --agent-link-muted: #9aa3b2;
    --agent-link-border: #3a3f4b;
    --agent-link-surface: #1d1f27;
    --agent-link-surface-muted: #262a33;
  }
}

.agent-link-panel__heading {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--agent-link-blue);
}

.agent-link-panel__heading--warning {
  color: var(--agent-link-amber);
}

.agent-link-panel__intro,
.agent-link-panel__reassurance,
.agent-link-panel__memory-cue {
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--agent-link-muted);
}

.agent-link-panel__memory-cue {
  padding: 8px 10px;
  border-left: 2px solid var(--agent-link-border);
  background: var(--agent-link-surface-muted);
}

.agent-link-panel__memory-cue--centered {
  text-align: center;
  border-left: 0;
}

.agent-link-panel__quiet-state {
  flex: 1 1 auto;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
}

.agent-link-panel__quiet-state p {
  max-width: 250px;
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--agent-link-muted);
}

.agent-link-panel__prompt,
.agent-link-panel__command {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--agent-link-border);
  background: var(--agent-link-surface-muted);
  font-family: "Menlo", ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--agent-link-ink);
}

/* Keep the connection handoff readable without changing the spacing
   of primary actions elsewhere in the rail. */
.agent-link-panel__prompt + .agent-link-panel__btn {
  margin-top: 8px;
}

.agent-link-panel__btn {
  align-self: flex-start;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background-color 200ms ease, border-color 200ms ease;
}

.agent-link-panel__btn--primary {
  background: var(--agent-link-blue);
  color: #fff;
}
.agent-link-panel__btn--primary:hover {
  background: var(--agent-link-blue-hover);
}

.agent-link-panel__btn--secondary {
  background: transparent;
  border-color: var(--agent-link-border);
  color: var(--agent-link-ink);
}
.agent-link-panel__btn--secondary:hover {
  background: var(--agent-link-surface-muted);
}

.agent-link-panel__status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--agent-link-muted);
}

.agent-link-panel__pulse-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--agent-link-blue);
}

.agent-link-panel__live-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--agent-link-green);
}

.agent-link-panel__status--pulse .agent-link-panel__pulse-dot {
  animation: agent-link-pulse 1.4s ease-in-out infinite;
}

@keyframes agent-link-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .agent-link-panel__status--pulse .agent-link-panel__pulse-dot,
  .agent-link-banner__spin {
    animation: none !important;
  }
  .agent-link-panel__feed-ic :deep(.agent-link-panel__feed-spin) {
    animation: none !important;
  }
}

.agent-link-panel__disclosure {
  font-size: 12px;
  color: var(--agent-link-muted);
  margin-top: 14px;
}
.agent-link-panel__disclosure summary {
  cursor: pointer;
  color: var(--agent-link-blue);
}

.agent-link-panel__setup {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
}

.agent-link-panel__setup p {
  margin: 0;
  color: var(--agent-link-muted);
  font-size: 12px;
  line-height: 1.45;
}

.agent-link-panel__connection-status :deep(.agent-status-header) {
  margin-bottom: 0;
}

.agent-link-panel__divider {
  font-size: 11px;
  color: var(--agent-link-muted);
  text-transform: uppercase;
}

.agent-link-panel__link {
  font-size: 12px;
  color: var(--agent-link-blue);
}

/* bound-diagram line */
.agent-link-panel__bound {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  background: var(--agent-link-surface-muted);
  border: 1px solid var(--agent-link-border);
  border-radius: 6px;
  font-size: 12px;
}
.agent-link-panel__bound svg {
  width: 15px;
  height: 15px;
  color: var(--agent-link-muted);
  flex: 0 0 auto;
}
.agent-link-panel__bound-lbl {
  color: var(--agent-link-muted);
}
.agent-link-panel__bound b {
  font-weight: 600;
}

/* thinking banner */
.agent-link-banner {
  display: flex;
  gap: 10px;
  padding: 12px;
  border-radius: 6px;
}
.agent-link-banner__spin {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  margin-top: 1px;
  animation: agent-link-banner-spin 1s linear infinite;
}
.agent-link-banner__body {
  flex: 1 1 auto;
  min-width: 0;
}
.agent-link-banner__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}
.agent-link-banner__sub {
  margin: 3px 0 0;
  font-size: 12px;
  line-height: 1.4;
}
.agent-link-banner__elapsed {
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
.agent-link-banner--work {
  background: #eff4ff;
  color: #1d4ed8;
}
.agent-link-banner--work .agent-link-banner__sub {
  color: #3b62c0;
}
@keyframes agent-link-banner-spin {
  to { transform: rotate(360deg); }
}

/* activity feed */
.agent-link-panel__feed-head {
  margin: 0;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
  color: var(--agent-link-faint);
}
.agent-link-panel__feed {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-link-panel__feed-row {
  display: flex;
  gap: 9px;
  align-items: baseline;
  padding: 7px 8px;
  border-radius: 6px;
  transition: background-color 200ms ease;
}
.agent-link-panel__feed-row--inflight {
  background: #eff4ff;
}
.agent-link-panel__feed-ic {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  align-self: flex-start;
  margin-top: 1px;
}
.agent-link-panel__feed-ic :deep(svg) {
  width: 18px;
  height: 18px;
}
.agent-link-panel__feed-ic--ok { color: var(--agent-link-green); }
.agent-link-panel__feed-ic--err { color: #ca3521; }
.agent-link-panel__feed-ic--warn { color: #8a6d00; }
.agent-link-panel__feed-ic--work { color: var(--agent-link-blue); }
.agent-link-panel__feed-ic--muted { color: var(--agent-link-muted); }
/* feed icons are injected via v-html, so the spin class needs :deep to cross
   the scoped-CSS boundary. */
.agent-link-panel__feed-ic :deep(.agent-link-panel__feed-spin) {
  animation: agent-link-banner-spin 1s linear infinite;
}
.agent-link-panel__feed-summary {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: var(--agent-link-ink);
  line-height: 1.35;
}
.agent-link-panel__feed-time {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--agent-link-faint);
  font-variant-numeric: tabular-nums;
}
.agent-link-panel__feed-empty {
  font-size: 12px;
  color: var(--agent-link-muted);
}

.agent-link-panel__hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--agent-link-muted);
}
</style>
