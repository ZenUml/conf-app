<template>
  <div class="agent-link-panel" :class="`agent-link-panel--${state}`" data-testid="agent-link-panel">
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

    <!-- connected: activity feed + open fullscreen + disconnect -->
    <template v-else-if="state === 'connected'">
      <div data-testid="agent-link-connected">
        <h3 class="agent-link-panel__heading agent-link-panel__heading--connected">Agent connected</h3>

        <h4 class="agent-link-panel__subheading">Activity</h4>
        <ul class="agent-link-panel__feed" data-testid="agent-link-activity-feed">
          <li
            v-for="(entry, index) in activityFeed"
            :key="`${entry.at}-${index}`"
            class="agent-link-panel__feed-entry"
            data-testid="agent-link-activity-entry"
          >
            <span class="agent-link-panel__feed-summary">{{ entry.summary }}</span>
            <span class="agent-link-panel__feed-time">{{ formatTime(entry.at) }}</span>
          </li>
          <li v-if="activityFeed.length === 0" class="agent-link-panel__feed-empty">
            No edits yet — ask your agent to make a change.
          </li>
        </ul>

        <button
          type="button"
          class="agent-link-panel__btn agent-link-panel__btn--secondary"
          data-testid="agent-link-open-fullscreen-btn"
          @click="emit('open-fullscreen')"
        >Open fullscreen</button>

        <button
          type="button"
          class="agent-link-panel__btn agent-link-panel__btn--danger"
          data-testid="agent-link-disconnect-btn"
          @click="emit('disconnect')"
        >Disconnect</button>

        <p class="agent-link-panel__session-line" data-testid="agent-link-session-line">
          session {{ token }} <span class="agent-link-panel__live-dot" aria-hidden="true"></span> live
        </p>
      </div>
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
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref } from 'vue'
import type { AgentLinkClientState } from '@/composables/agentLink/agentLinkState'
import type { AgentLinkActivityEntry } from '@/composables/agentLink/useAgentLinkSession'

// The MCP command from the design doc (§9 / relay host decision §14.3 —
// zenapi.zenuml.com to avoid a new egress host / re-consent).
const MCP_ADD_COMMAND = 'claude mcp add --transport http zenuml https://zenapi.zenuml.com/agent-link/mcp'

const props = defineProps<{
  state: AgentLinkClientState
  token: string | null
  activityFeed: AgentLinkActivityEntry[]
}>()

const emit = defineEmits<{
  (e: 'open-fullscreen'): void
  (e: 'disconnect'): void
}>()

// Shared "setup the connector" block used by both the waiting-state
// collapsed <details> and the always-expanded timeout state, so the copy
// and markup only exist once.
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
</script>

<style scoped>
.agent-link-panel {
  --agent-link-violet: #6c4cf0;
  --agent-link-violet-dark: #5936d9;
  --agent-link-green: #16a66b;
  --agent-link-amber: #c4761f;
  --agent-link-ink: #172b4d;
  --agent-link-muted: #626f86;
  --agent-link-border: #e3e6ea;
  --agent-link-surface: #ffffff;
  --agent-link-surface-muted: #f5f4ff;

  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--agent-link-ink);
  background: var(--agent-link-surface);
  box-sizing: border-box;
}

@media (prefers-color-scheme: dark) {
  .agent-link-panel {
    --agent-link-ink: #e6e8ee;
    --agent-link-muted: #9aa3b2;
    --agent-link-border: #3a3f4b;
    --agent-link-surface: #1d1f27;
    --agent-link-surface-muted: #262233;
  }
}

.agent-link-panel__heading {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--agent-link-violet);
}

.agent-link-panel__heading--connected {
  color: var(--agent-link-green);
}

.agent-link-panel__heading--warning {
  color: var(--agent-link-amber);
}

.agent-link-panel__subheading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--agent-link-muted);
}

.agent-link-panel__prompt,
.agent-link-panel__command {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--agent-link-border);
  background: var(--agent-link-surface-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
}

.agent-link-panel__btn--primary {
  background: var(--agent-link-violet);
  color: #fff;
}
.agent-link-panel__btn--primary:hover {
  background: var(--agent-link-violet-dark);
}

.agent-link-panel__btn--secondary {
  background: transparent;
  border-color: var(--agent-link-border);
  color: var(--agent-link-ink);
}
.agent-link-panel__btn--secondary:hover {
  background: var(--agent-link-surface-muted);
}

.agent-link-panel__btn--danger {
  background: transparent;
  border-color: var(--agent-link-border);
  color: var(--agent-link-amber);
}
.agent-link-panel__btn--danger:hover {
  background: var(--agent-link-surface-muted);
}

.agent-link-panel__status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  color: var(--agent-link-muted);
}

.agent-link-panel__pulse-dot,
.agent-link-panel__live-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--agent-link-violet);
}

.agent-link-panel__live-dot {
  background: var(--agent-link-green);
}

.agent-link-panel__status--pulse .agent-link-panel__pulse-dot {
  animation: agent-link-pulse 1.4s ease-in-out infinite;
}

@keyframes agent-link-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}

.agent-link-panel__disclosure {
  font-size: 12px;
  color: var(--agent-link-muted);
}
.agent-link-panel__disclosure summary {
  cursor: pointer;
  color: var(--agent-link-violet);
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
  color: var(--agent-link-violet);
}

.agent-link-panel__feed {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.agent-link-panel__feed-entry {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--agent-link-surface-muted);
  font-size: 12px;
}

.agent-link-panel__feed-summary {
  color: var(--agent-link-ink);
}

.agent-link-panel__feed-time {
  flex-shrink: 0;
  color: var(--agent-link-muted);
}

.agent-link-panel__feed-empty {
  font-size: 12px;
  color: var(--agent-link-muted);
}

.agent-link-panel__session-line {
  margin: 0;
  font-size: 11px;
  color: var(--agent-link-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-link-panel__hint {
  margin: 0;
  font-size: 12px;
  color: var(--agent-link-muted);
}
</style>
