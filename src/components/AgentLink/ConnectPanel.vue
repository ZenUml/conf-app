<template>
  <div class="agent-link-panel" :class="`agent-link-panel--${state}`" data-testid="agent-link-panel">
    <div class="agent-link-panel__scroll">
      <!-- waiting: paste prompt + copy + pulsing status + collapsed setup -->
      <template v-if="state === 'waiting'">
        <div data-testid="agent-link-waiting">
          <h3 class="agent-link-panel__heading">Edit with your agent</h3>

          <pre class="agent-link-panel__prompt" data-testid="agent-link-prompt">{{ promptText }}</pre>

          <button
            type="button"
            class="agent-link-panel__btn agent-link-panel__btn--primary"
            data-testid="agent-link-copy-prompt-btn"
            @click="onCopyPrompt"
          >{{ copyState === 'copied' ? '✓ Copied' : 'Copy prompt' }}</button>

          <p class="agent-link-panel__status agent-link-panel__status--pulse" data-testid="agent-link-waiting-status">
            <span class="agent-link-panel__pulse-dot" aria-hidden="true"></span>
            Waiting for your agent to connect…
          </p>

          <details class="agent-link-panel__disclosure" data-testid="agent-link-setup-disclosure">
            <summary>First time? Set up the connector (once)</summary>
            <SetupInstructions />
          </details>
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
          />

          <div class="agent-link-panel__bound">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
            <span><span class="agent-link-panel__bound-lbl">Linked to</span> <b>{{ diagramTitle || 'this diagram' }}</b></span>
          </div>

          <SessionTtl :expires-at="expiresAt" />

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

          <p class="agent-link-panel__session-line" data-testid="agent-link-session-line">
            session {{ token }} <span class="agent-link-panel__live-dot" aria-hidden="true"></span> live
          </p>
        </div>
      </template>

      <!-- suspended (Track G): the relay socket dropped unexpectedly but is
           still resumable within the token TTL. Amber "reconnecting" banner. -->
      <template v-else-if="state === 'suspended'">
        <div data-testid="agent-link-suspended">
          <AgentStatusHeader
            :state="state"
            :client-name="clientName"
            :diagram-title="diagramTitle"
          />

          <div class="agent-link-banner agent-link-banner--warn">
            <svg class="agent-link-banner__spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            <div class="agent-link-banner__body">
              <h3 class="agent-link-banner__title agent-link-panel__heading--warning">Connection paused — reconnecting…</h3>
              <p class="agent-link-banner__sub" data-testid="agent-link-suspended-status">
                Waiting for the macro to reconnect. The agent will retry its next request
              </p>
              <div v-if="resumeText" class="agent-link-banner__countdown">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>{{ resumeText }}
              </div>
            </div>
          </div>

          <h4 class="agent-link-panel__feed-head">Activity</h4>
          <ul class="agent-link-panel__feed">
            <li
              v-for="(row, index) in feedRows"
              :key="`${row.at}-${index}`"
              class="agent-link-panel__feed-row"
              data-testid="agent-link-activity-entry"
            >
              <span class="agent-link-panel__feed-ic" :class="`agent-link-panel__feed-ic--${row.tone}`" aria-hidden="true" v-html="row.icon"></span>
              <span class="agent-link-panel__feed-summary">{{ row.summary }}</span>
              <span class="agent-link-panel__feed-time">{{ formatTime(row.at) }}</span>
            </li>
          </ul>
        </div>
      </template>

      <!-- closed (Track G, terminal): explicit Disconnect or TTL expiry. The
           diagram is saved; Reconnect mints a fresh session. -->
      <template v-else-if="state === 'closed'">
        <SessionNotice variant="closed" :diagram-title="diagramTitle" @reconnect="emit('reconnect')" />
      </template>

      <!-- timeout: warning + expanded setup -->
      <template v-else-if="state === 'timeout'">
        <div data-testid="agent-link-timeout">
          <h3 class="agent-link-panel__heading agent-link-panel__heading--warning">No agent yet — first time here?</h3>

          <pre class="agent-link-panel__prompt" data-testid="agent-link-prompt">{{ promptText }}</pre>

          <button
            type="button"
            class="agent-link-panel__btn agent-link-panel__btn--primary"
            data-testid="agent-link-copy-prompt-btn"
            @click="onCopyPrompt"
          >{{ copyState === 'copied' ? '✓ Copied' : 'Copy prompt' }}</button>

          <SetupInstructions />

          <p class="agent-link-panel__hint" data-testid="agent-link-retry-hint">Then paste the prompt again.</p>
        </div>
      </template>
    </div>

    <!-- Pinned footer actions for the active + suspended rail. Closed renders
         its own Reconnect CTA inside SessionNotice. -->
    <RailActions
      v-if="state === 'connected' || state === 'suspended'"
      @disconnect="emit('disconnect')"
      @revoke="emit('revoke')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, ref, watch } from 'vue'
import type { AgentLinkClientState, AgentLinkThinkingState } from '@/composables/agentLink/agentLinkState'
import type { AgentLinkActivityEntry } from '@/composables/agentLink/useAgentLinkSession'
import AgentStatusHeader from './AgentStatusHeader.vue'
import SessionTtl from './SessionTtl.vue'
import RailActions from './RailActions.vue'
import SessionNotice from './SessionNotice.vue'

// The MCP command from the design doc (§9 / relay host decision §14.3 —
// zenapi.zenuml.com to avoid a new egress host / re-consent).
const MCP_ADD_COMMAND = 'claude mcp add --transport http zenuml https://zenapi.zenuml.com/agent-link/mcp'

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
    thinking?: AgentLinkThinkingState
    diagramTitle?: string
    clientName?: string
    expiresAt?: number | null
  }>(),
  { thinking: 'idle', diagramTitle: '', clientName: '', expiresAt: null }
)

const emit = defineEmits<{
  (e: 'disconnect'): void
  // Track G: "Revoke & re-link" — closes the current session and immediately
  // mints a fresh one, in one click.
  (e: 'revoke'): void
  // Track H: "Reconnect" from the terminal (closed) notice — mints a fresh
  // session after an explicit disconnect / expiry.
  (e: 'reconnect'): void
}>()

// Shared "setup the connector" block used by both the waiting-state collapsed
// <details> and the always-expanded timeout state, so the copy and markup only
// exist once.
const SetupInstructions = defineComponent({
  name: 'AgentLinkSetupInstructions',
  setup() {
    return () =>
      h('div', { class: 'agent-link-panel__setup', 'data-testid': 'agent-link-setup' }, [
        h(
          'button',
          {
            type: 'button',
            class: 'agent-link-panel__btn agent-link-panel__btn--secondary',
            'data-testid': 'agent-link-add-cursor-btn',
          },
          'Add to Cursor'
        ),
        h(
          'pre',
          { class: 'agent-link-panel__command', 'data-testid': 'agent-link-setup-command' },
          MCP_ADD_COMMAND
        ),
        h('div', { class: 'agent-link-panel__divider', 'data-testid': 'agent-link-setup-divider' }, 'or'),
        h(
          'a',
          {
            href: '#',
            class: 'agent-link-panel__link',
            'data-testid': 'agent-link-no-install-link',
          },
          'Use the no-install bridge instead'
        ),
      ])
  },
})

const promptText = computed(() => {
  const sessionToken = props.token ?? ''
  return [
    'Connect to my ZenUML diagram via the conf-agent MCP.',
    `session: ${sessionToken}`,
    '# reads this page · edits this diagram · 10 min',
  ].join('\n')
})

type CopyState = 'default' | 'copied' | 'failed'
const copyState = ref<CopyState>('default')
let copyRevertTimer: ReturnType<typeof setTimeout> | null = null

async function onCopyPrompt() {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(promptText.value)
      copyState.value = 'copied'
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
} as const

interface FeedRow {
  summary: string
  at: number
  kind: 'normal' | 'inflight'
  tone: 'ok' | 'err' | 'warn' | 'work'
  icon: string
}

function classifyRow(entry: AgentLinkActivityEntry): FeedRow {
  const s = entry.summary
  if (s.startsWith('⚠')) return { ...entry, kind: 'normal', tone: 'err', icon: ICONS.error }
  if (s === 'Connection paused') return { ...entry, kind: 'normal', tone: 'warn', icon: ICONS.pause }
  if (s.startsWith('Reconnected')) return { ...entry, kind: 'normal', tone: 'ok', icon: ICONS.resume }
  // In-flight "updating" cue (ends with an ellipsis) → spinning work icon.
  if (s.includes('updating') || s.endsWith('…')) {
    return { ...entry, kind: 'inflight', tone: 'work', icon: ICONS.spin }
  }
  return { ...entry, kind: 'normal', tone: 'ok', icon: ICONS.check }
}

const feedRows = computed<FeedRow[]>(() => props.activityFeed.map(classifyRow))

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
})

const elapsedHint = computed(() =>
  thinkingElapsed.value >= ELAPSED_HINT_AFTER_SECONDS ? `· ${thinkingElapsed.value}s` : ''
)

// --- Suspended resume countdown ----------------------------------------------
// Reuses the token expiry as the resume window (the session is resumable until
// the token TTL lapses). Renders nothing when no expiry is known.
const resumeNow = ref(Date.now())
let resumeTimer: ReturnType<typeof setInterval> | null = null

watch(
  () => [props.state, props.expiresAt] as const,
  ([st, exp]) => {
    if (resumeTimer !== null) {
      clearInterval(resumeTimer)
      resumeTimer = null
    }
    if (st === 'suspended' && exp !== null && exp !== undefined) {
      resumeNow.value = Date.now()
      resumeTimer = setInterval(() => {
        resumeNow.value = Date.now()
      }, 1000)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (resumeTimer !== null) clearInterval(resumeTimer)
})

const resumeText = computed(() => {
  if (props.state !== 'suspended' || props.expiresAt === null || props.expiresAt === undefined) return ''
  const remaining = Math.max(0, Math.ceil((props.expiresAt - resumeNow.value) / 1000))
  const m = Math.floor(remaining / 60)
  const sec = remaining % 60
  return `Resumes if reconnected within ${m}:${sec.toString().padStart(2, '0')}`
})
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

.agent-link-panel--suspended {
  border-color: var(--agent-link-amber);
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
  margin-top: 10px;
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

/* thinking / suspended banner */
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
.agent-link-banner--warn .agent-link-banner__spin {
  animation-duration: 1.1s;
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
.agent-link-banner__countdown {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.agent-link-banner__countdown svg {
  width: 13px;
  height: 13px;
}
.agent-link-banner--work {
  background: #eff4ff;
  color: #1d4ed8;
}
.agent-link-banner--work .agent-link-banner__sub {
  color: #3b62c0;
}
.agent-link-banner--warn {
  background: #fbf3d6;
  color: #8a6d00;
}
.agent-link-banner--warn .agent-link-banner__sub {
  color: #96790c;
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

.agent-link-panel__session-line {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--agent-link-muted);
  display: flex;
  align-items: center;
  gap: 6px;
  word-break: break-all;
}

.agent-link-panel__hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--agent-link-muted);
}
</style>
