<template>
  <div
    v-if="visible"
    class="connect-mcp-overlay"
    data-testid="connect-mcp-dialog"
    :data-agent-link-state="state"
    @click.self="emit('close')"
  >
    <div
      class="connect-mcp-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-mcp-dialog-title"
    >
      <header class="connect-mcp-header">
        <h2 id="connect-mcp-dialog-title" class="connect-mcp-title">Connect MCP</h2>
        <button
          type="button"
          class="connect-mcp-close"
          aria-label="Close"
          data-testid="connect-mcp-close"
          @click="emit('close')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="connect-mcp-icon" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div class="connect-mcp-body">
        <!-- Paired: the agent can edit now; edits render live in the macro. -->
        <template v-if="state === 'connected' || state === 'suspended'">
          <div class="connect-mcp-status connect-mcp-status--ok" data-testid="connect-mcp-connected">
            <span class="connect-mcp-dot connect-mcp-dot--ok" aria-hidden="true"></span>
            <div>
              <p class="connect-mcp-status-title">
                {{ state === 'connected' ? 'Your agent is connected' : 'Connection paused — reconnecting…' }}
              </p>
              <p class="connect-mcp-status-sub">
                Ask your agent to change <b>{{ diagramTitle || 'this diagram' }}</b>. Edits are saved and appear here live.
              </p>
            </div>
          </div>
          <div class="connect-mcp-actions">
            <button
              type="button"
              class="connect-mcp-btn connect-mcp-btn--secondary"
              data-testid="agent-link-disconnect-btn"
              @click="emit('disconnect')"
            >Disconnect</button>
            <button
              type="button"
              class="connect-mcp-btn connect-mcp-btn--primary"
              data-testid="connect-mcp-done"
              @click="emit('close')"
            >Done</button>
          </div>
        </template>

        <!-- Terminal / rejected: no usable session — offer a fresh one. -->
        <template v-else-if="isTerminal">
          <div class="connect-mcp-status connect-mcp-status--warn" data-testid="connect-mcp-ended">
            <span class="connect-mcp-dot connect-mcp-dot--warn" aria-hidden="true"></span>
            <div>
              <p class="connect-mcp-status-title">{{ terminalTitle }}</p>
              <p class="connect-mcp-status-sub">{{ terminalBody }}</p>
            </div>
          </div>
          <div class="connect-mcp-actions">
            <button
              type="button"
              class="connect-mcp-btn connect-mcp-btn--primary"
              data-testid="connect-mcp-retry"
              @click="emit('retry')"
            >Start a new session</button>
          </div>
        </template>

        <!-- Waiting for the agent: setup command + session prompt. -->
        <template v-else>
          <ol class="connect-mcp-steps">
            <li class="connect-mcp-step">
              <p class="connect-mcp-step-title">
                <span class="connect-mcp-step-num" aria-hidden="true">1</span>
                Add the ZenUML MCP server <span class="connect-mcp-muted">(once)</span>
              </p>
              <div class="connect-mcp-code-row">
                <pre class="connect-mcp-code" data-testid="connect-mcp-setup-command">{{ setupCommand }}</pre>
                <button
                  type="button"
                  class="connect-mcp-copy"
                  data-testid="connect-mcp-copy-setup"
                  @click="copy('setup_command', setupCommand)"
                >{{ copyLabel('setup_command') }}</button>
              </div>
              <p class="connect-mcp-hint">
                Other MCP clients (Cursor, VS Code…): add a remote HTTP server named
                <code>{{ serverName }}</code> with URL <code>{{ serverUrl }}</code>.
              </p>
            </li>
            <li class="connect-mcp-step">
              <p class="connect-mcp-step-title">
                <span class="connect-mcp-step-num" aria-hidden="true">2</span>
                Paste this prompt into your agent
              </p>
              <div class="connect-mcp-code-row">
                <pre
                  class="connect-mcp-code"
                  :class="{ 'connect-mcp-code--pending': !tokenReady }"
                  data-testid="connect-mcp-prompt"
                >{{ tokenReady ? promptText : 'Starting a session for this diagram…' }}</pre>
                <button
                  type="button"
                  class="connect-mcp-copy"
                  data-testid="connect-mcp-copy-prompt"
                  :disabled="!tokenReady"
                  @click="copy('prompt', promptText)"
                >{{ copyLabel('prompt') }}</button>
              </div>
            </li>
          </ol>
          <p class="connect-mcp-waiting" role="status" data-testid="connect-mcp-waiting">
            <span class="connect-mcp-dot connect-mcp-dot--pulse" aria-hidden="true"></span>
            {{ state === 'timeout' ? 'No agent yet — finish step 1, then paste the prompt again.' : 'Waiting for your agent to connect…' }}
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AgentLinkClientState } from '@/composables/agentLink/agentLinkState'
import type { AgentLinkMcpCopyTarget } from '@/utils/analytics/catalog'
import {
  MCP_ADD_COMMAND,
  MCP_SERVER_NAME,
  MCP_SERVER_URL,
  buildConnectPrompt,
  isUsableSessionToken,
} from '@/composables/agentLink/connectInstructions'

// Inline counterpart to the Fullscreen ConnectPanel rail: the viewer's
// "Connect MCP" button opens this over the macro. It renders the host's
// useAgentLinkSession() state and never touches the session itself — the
// host mints/closes the session and fires the analytics.
const props = withDefaults(
  defineProps<{
    visible: boolean
    state: AgentLinkClientState
    token: string | null
    diagramTitle?: string
  }>(),
  { diagramTitle: '' }
)

const emit = defineEmits<{
  (e: 'close'): void
  // Mint a fresh session after a closed/expired/failed/rejected one.
  (e: 'retry'): void
  (e: 'disconnect'): void
  (e: 'copy', target: AgentLinkMcpCopyTarget, ok: boolean): void
}>()

const setupCommand = MCP_ADD_COMMAND
const serverName = MCP_SERVER_NAME
const serverUrl = MCP_SERVER_URL

const tokenReady = computed(() => isUsableSessionToken(props.token))
const promptText = computed(() => buildConnectPrompt(props.token))

const isTerminal = computed(() =>
  ['closed', 'expired', 'failed', 'already_linked'].includes(props.state)
)

const terminalTitle = computed(() => {
  switch (props.state) {
    case 'already_linked': return 'Another agent is linked to this diagram'
    case 'expired': return 'Session expired'
    case 'failed': return 'Could not start a session'
    default: return 'Session ended'
  }
})

const terminalBody = computed(() => {
  switch (props.state) {
    case 'already_linked': return 'Starting a new session disconnects the other agent.'
    case 'failed': return 'Something went wrong on our side. Try again in a moment.'
    default: return 'Your diagram is saved. Start a new session to keep editing with your agent.'
  }
})

type CopyState = 'idle' | 'copied' | 'failed'
const copyStates = ref<Record<AgentLinkMcpCopyTarget, CopyState>>({ setup_command: 'idle', prompt: 'idle' })
const revertTimers: Partial<Record<AgentLinkMcpCopyTarget, ReturnType<typeof setTimeout>>> = {}

function copyLabel(target: AgentLinkMcpCopyTarget): string {
  const s = copyStates.value[target]
  if (s === 'copied') return 'Copied'
  if (s === 'failed') return 'Select & copy'
  return 'Copy'
}

async function writeClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* fall through to the legacy path */
    }
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.setAttribute('readonly', '')
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

async function copy(target: AgentLinkMcpCopyTarget, text: string) {
  const ok = await writeClipboard(text)
  copyStates.value = { ...copyStates.value, [target]: ok ? 'copied' : 'failed' }
  const pending = revertTimers[target]
  if (pending) clearTimeout(pending)
  revertTimers[target] = setTimeout(() => {
    copyStates.value = { ...copyStates.value, [target]: 'idle' }
  }, 2000)
  emit('copy', target, ok)
}

function clearTimers() {
  for (const t of Object.values(revertTimers)) if (t) clearTimeout(t)
}

watch(
  () => props.visible,
  (open) => {
    if (!open) {
      clearTimers()
      copyStates.value = { setup_command: 'idle', prompt: 'idle' }
    }
  }
)

onBeforeUnmount(clearTimers)
</script>

<style scoped>
/* Inline macro overlay. Like ViewSourcePanel, it is bound to .viewer-frame
   (position:relative); the host gives the frame a min size while the dialog
   is open so Forge's autoResize grows the iframe to fit it. */
.connect-mcp-overlay {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 8px;
  background: rgba(9, 30, 66, 0.24);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.connect-mcp-dialog {
  width: min(440px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.connect-mcp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #E5E7EB;
  flex-shrink: 0;
}

.connect-mcp-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #172B4D;
}

.connect-mcp-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  color: #6B7280;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.connect-mcp-close:hover { background: #F3F4F6; color: #111827; }

.connect-mcp-icon { width: 16px; height: 16px; }

.connect-mcp-body {
  padding: 12px;
  overflow: auto;
  font-size: 13px;
  color: #374151;
}

.connect-mcp-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.connect-mcp-step-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  font-weight: 600;
  color: #111827;
}

.connect-mcp-step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #2563EB;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.connect-mcp-muted { color: #6B7280; font-weight: 400; }

.connect-mcp-code-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.connect-mcp-code {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 8px 10px;
  background: #F9FAFB;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #111827;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: all;
}
.connect-mcp-code--pending { color: #6B7280; font-style: italic; user-select: none; }

.connect-mcp-copy {
  flex-shrink: 0;
  align-self: flex-start;
  padding: 6px 10px;
  background: #F3F4F6;
  color: #111827;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.connect-mcp-copy:hover:not(:disabled) { background: #E5E7EB; }
.connect-mcp-copy:disabled { opacity: 0.45; cursor: not-allowed; }

.connect-mcp-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #6B7280;
}
.connect-mcp-hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  color: #374151;
  overflow-wrap: anywhere;
}

.connect-mcp-waiting {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 0;
  font-size: 12px;
  color: #4B5563;
}

.connect-mcp-status {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.connect-mcp-status-title { margin: 0; font-weight: 600; color: #111827; }
.connect-mcp-status-sub { margin: 4px 0 0; color: #4B5563; }

.connect-mcp-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #2563EB;
}
.connect-mcp-status .connect-mcp-dot { margin-top: 6px; }
.connect-mcp-dot--ok { background: #16A34A; }
.connect-mcp-dot--warn { background: #D97706; }
.connect-mcp-dot--pulse { animation: connect-mcp-pulse 1.4s ease-in-out infinite; }

@keyframes connect-mcp-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
@media (prefers-reduced-motion: reduce) {
  .connect-mcp-dot--pulse { animation: none; }
}

.connect-mcp-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.connect-mcp-btn {
  padding: 6px 12px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}
.connect-mcp-btn--primary { background: #2563EB; color: #fff; }
.connect-mcp-btn--primary:hover { background: #1D4ED8; }
.connect-mcp-btn--secondary { background: #fff; color: #374151; border-color: #D1D5DB; }
.connect-mcp-btn--secondary:hover { background: #F3F4F6; }
</style>
