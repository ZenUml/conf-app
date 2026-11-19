<template>
  <div
    v-if="visible"
    class="connect-mcp-overlay"
    data-testid="connect-mcp-dialog"
    data-mcp-mode="headless"
    @click.self="emit('close', 'backdrop')"
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
          @click="emit('close', 'close_button')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="connect-mcp-icon" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div class="connect-mcp-body">
        <p class="connect-mcp-lede" data-testid="connect-mcp-lede">
          Let your AI agent read this diagram and update it from your codebase.
          It signs in with your Atlassian account, so it sees only what you can see.
        </p>
        <ol class="connect-mcp-steps">
          <li class="connect-mcp-step">
            <p class="connect-mcp-step-title">
              <span class="connect-mcp-step-num" aria-hidden="true">1</span>
              Add the {{ productName }} MCP server <span class="connect-mcp-muted">(once)</span>
            </p>
            <div class="connect-mcp-tabs" role="tablist" aria-label="Your MCP client">
              <button
                v-for="c in MCP_CLIENTS"
                :id="`connect-mcp-tab-${c.id}`"
                :key="c.id"
                type="button"
                role="tab"
                class="connect-mcp-tab"
                :class="{ 'connect-mcp-tab--active': c.id === client }"
                :aria-selected="c.id === client ? 'true' : 'false'"
                :aria-controls="'connect-mcp-panel'"
                :tabindex="c.id === client ? 0 : -1"
                :data-testid="`connect-mcp-tab-${c.id}`"
                @click="selectClient(c.id)"
                @keydown.right.prevent="moveTab(1)"
                @keydown.left.prevent="moveTab(-1)"
              >{{ c.label }}</button>
            </div>
            <div
              id="connect-mcp-panel"
              class="connect-mcp-panel"
              role="tabpanel"
              :aria-labelledby="`connect-mcp-tab-${client}`"
              :data-client="client"
              data-testid="connect-mcp-client-panel"
            >
              <template v-if="cliCommand">
                <p class="connect-mcp-hint connect-mcp-hint--lead">Run this in your terminal:</p>
                <div class="connect-mcp-code-row">
                  <pre class="connect-mcp-code" data-testid="connect-mcp-setup-command">{{ cliCommand }}</pre>
                  <button
                    type="button"
                    class="connect-mcp-copy"
                    data-testid="connect-mcp-copy-setup"
                    @click="copy('setup_command', cliCommand)"
                  >{{ copyLabel('setup_command') }}</button>
                </div>
                <p v-if="client === 'codex'" class="connect-mcp-hint" data-testid="connect-mcp-codex-login">
                  It then opens your browser to sign in with Atlassian. If it doesn't, run <code>codex mcp login {{ serverName }}</code>.
                </p>
              </template>
              <template v-else>
                <div
                  v-if="installLink"
                  class="connect-mcp-install"
                >
                  <button
                    type="button"
                    class="connect-mcp-btn connect-mcp-btn--primary"
                    data-testid="connect-mcp-install"
                    @click="install"
                  >{{ installLink.label }}</button>
                  <span class="connect-mcp-muted">or add it by URL:</span>
                </div>
                <template v-else-if="client === 'other'">
                  <p class="connect-mcp-hint connect-mcp-hint--lead" data-testid="connect-mcp-client-steps">
                    If your agent can run commands or edit files, paste this and it adds the server itself:
                  </p>
                  <div class="connect-mcp-code-row connect-mcp-code-row--spaced">
                    <pre class="connect-mcp-code" data-testid="connect-mcp-install-prompt">{{ installPrompt }}</pre>
                    <button
                      type="button"
                      class="connect-mcp-copy"
                      data-testid="connect-mcp-copy-install-prompt"
                      @click="copy('install_prompt', installPrompt)"
                    >{{ copyLabel('install_prompt') }}</button>
                  </div>
                  <p class="connect-mcp-hint connect-mcp-hint--lead">Or add a remote HTTP server named <code>{{ serverName }}</code> with this URL:</p>
                </template>
                <p v-else class="connect-mcp-hint connect-mcp-hint--lead" data-testid="connect-mcp-client-steps">{{ urlSteps }}</p>
                <div class="connect-mcp-code-row">
                  <pre class="connect-mcp-code" data-testid="connect-mcp-server-url">{{ serverUrl }}</pre>
                  <button
                    type="button"
                    class="connect-mcp-copy"
                    data-testid="connect-mcp-copy-url"
                    @click="copy('server_url', serverUrl)"
                  >{{ copyLabel('server_url') }}</button>
                </div>
              </template>
              <p v-if="client !== 'codex'" class="connect-mcp-hint">
                The first time, your client asks you to sign in with Atlassian.
              </p>
            </div>
          </li>
          <li class="connect-mcp-step">
            <p class="connect-mcp-step-title">
              <span class="connect-mcp-step-num" aria-hidden="true">2</span>
              Paste this prompt into your agent
            </p>
            <div class="connect-mcp-code-row">
              <pre class="connect-mcp-code" data-testid="connect-mcp-prompt">{{ promptText }}</pre>
              <button
                type="button"
                class="connect-mcp-copy"
                data-testid="connect-mcp-copy-prompt"
                @click="copy('prompt', promptText)"
              >{{ copyLabel('prompt') }}</button>
            </div>
          </li>
        </ol>
        <div class="connect-mcp-actions">
          <button
            type="button"
            class="connect-mcp-btn connect-mcp-btn--primary"
            data-testid="connect-mcp-done"
            @click="emit('close', 'done')"
          >Done</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AgentLinkMcpCloseSource, AgentLinkMcpCopyTarget } from '@/utils/analytics/catalog'
import {
  MCP_CLIENTS,
  type McpClientChoice,
  mcpServerName,
  mcpServerUrl,
  productLabel,
  buildHeadlessPrompt,
  buildInstallPrompt,
  mcpAddCommand,
  cursorInstallUrl,
  codexAddCommand,
  vscodeInstallUrl,
  rememberedMcpClient,
  rememberMcpClient,
} from '@/composables/agentLink/connectInstructions'
import { writeClipboard } from '@/composables/agentLink/clipboard'
import { openUrl } from '@/model/globals/forgeGlobal'

// The viewer's "Connect MCP" button opens this over the inline macro. First
// release: headless MCP only (connectInstructions.ts RELAY_SESSIONS_ENABLED),
// so there is no session to mint or track — the dialog shows how to add the
// server in the viewer's own MCP client (one tab per client, the last choice
// remembered) and a prompt naming this diagram. The host fires the analytics.
const props = withDefaults(
  defineProps<{
    visible: boolean
    diagramTitle?: string
    cloudId?: string
    pageId?: string
    contentId?: string
    /** Replaces the default "review this diagram" prompt (editor, new diagram). */
    prompt?: string
  }>(),
  { diagramTitle: '', cloudId: '', pageId: '', contentId: '', prompt: '' }
)

const emit = defineEmits<{
  (e: 'close', source: AgentLinkMcpCloseSource): void
  (e: 'copy', target: AgentLinkMcpCopyTarget, ok: boolean, client: McpClientChoice): void
  (e: 'select-client', client: McpClientChoice): void
  (e: 'install', client: McpClientChoice): void
}>()

// Read at setup: forgeGlobal's backend URL is resolved during app boot,
// before any component mounts.
const setupCommand = mcpAddCommand()
const serverUrl = mcpServerUrl()
const serverName = mcpServerName()
const productName = productLabel()

const installPrompt = buildInstallPrompt(serverUrl, serverName)
const client = ref<McpClientChoice>(rememberedMcpClient())

function selectClient(id: McpClientChoice) {
  if (id === client.value) return
  client.value = id
  rememberMcpClient(id)
  emit('select-client', id)
}

function moveTab(step: number) {
  const i = MCP_CLIENTS.findIndex((c) => c.id === client.value)
  const next = MCP_CLIENTS[(i + step + MCP_CLIENTS.length) % MCP_CLIENTS.length]
  selectClient(next.id)
  document.getElementById(`connect-mcp-tab-${next.id}`)?.focus()
}

const installLink = computed(() => {
  if (client.value === 'cursor') return { label: 'Add to Cursor', url: cursorInstallUrl(serverUrl, serverName) }
  if (client.value === 'vscode') return { label: 'Add to VS Code', url: vscodeInstallUrl(serverUrl, serverName) }
  return null
})

// Claude on the web or desktop: a custom connector by URL
// (claude.com/docs/connectors/custom/add-unlisted; on Team and Enterprise an
// owner adds it under Organization settings first). ChatGPT on the web: a
// custom MCP server under chatgpt.com/plugins
// (developers.openai.com/api/docs/guides/custom-mcp-server); it registers
// itself with our server (DCR) and signs in by OAuth. In both, a workspace
// owner or admin can restrict adding them.
const urlSteps = computed(() => (client.value === 'chatgpt'
  ? `In ChatGPT on the web, open chatgpt.com/plugins, choose + › Add custom MCP server, name it ${productName}, set authentication to OAuth and paste this URL:`
  : `In Claude, open Customize › Connectors, choose Add › Add custom connector, name it ${productName} and paste this URL:`))

// The tabs whose setup is one terminal command.
const cliCommand = computed(() => {
  if (client.value === 'claude_code') return setupCommand
  if (client.value === 'codex') return codexAddCommand(serverUrl, serverName)
  return ''
})

async function install() {
  const link = installLink.value
  if (!link) return
  emit('install', client.value)
  await openUrl(link.url)
}

const promptText = computed(() => props.prompt || buildHeadlessPrompt({
  title: props.diagramTitle,
  cloudId: props.cloudId,
  pageId: props.pageId,
  contentId: props.contentId,
}))

type CopyState = 'idle' | 'copied' | 'failed'
const idleStates = (): Record<AgentLinkMcpCopyTarget, CopyState> => ({ setup_command: 'idle', server_url: 'idle', install_prompt: 'idle', prompt: 'idle' })
const copyStates = ref<Record<AgentLinkMcpCopyTarget, CopyState>>(idleStates())
const revertTimers: Partial<Record<AgentLinkMcpCopyTarget, ReturnType<typeof setTimeout>>> = {}

function copyLabel(target: AgentLinkMcpCopyTarget): string {
  const s = copyStates.value[target]
  if (s === 'copied') return 'Copied'
  if (s === 'failed') return 'Select & copy'
  return 'Copy'
}

async function copy(target: AgentLinkMcpCopyTarget, text: string) {
  const ok = await writeClipboard(text)
  copyStates.value = { ...copyStates.value, [target]: ok ? 'copied' : 'failed' }
  const pending = revertTimers[target]
  if (pending) clearTimeout(pending)
  revertTimers[target] = setTimeout(() => {
    copyStates.value = { ...copyStates.value, [target]: 'idle' }
  }, 2000)
  emit('copy', target, ok, client.value)
}

function clearTimers() {
  for (const t of Object.values(revertTimers)) if (t) clearTimeout(t)
}

// Leaving the page with the dialog open used to leave no closed row; report
// it as its own close source. pagehide, not visibilitychange: switching to a
// terminal to paste the command hides the tab without leaving the dialog.
function onPageHide() {
  emit('close', 'page_hidden')
}

watch(
  () => props.visible,
  (open) => {
    if (open) {
      window.addEventListener('pagehide', onPageHide)
    } else {
      window.removeEventListener('pagehide', onPageHide)
      clearTimers()
      copyStates.value = idleStates()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', onPageHide)
  clearTimers()
})
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
  width: min(520px, 100%);
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

.connect-mcp-lede {
  margin: 0 0 12px;
  color: #374151;
  line-height: 1.45;
}

.connect-mcp-tabs {
  display: flex;
  flex-wrap: wrap;
  margin: 0 0 8px;
  border-bottom: 1px solid #E5E7EB;
}
.connect-mcp-tab {
  padding: 5px 7px;
  margin-bottom: -1px;
  background: transparent;
  color: #4B5563;
  border: none;
  border-bottom: 2px solid transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.connect-mcp-tab:hover { color: #111827; }
.connect-mcp-tab--active { color: #1D4ED8; border-bottom-color: #2563EB; }
.connect-mcp-tab:focus-visible { outline: 2px solid #2563EB; outline-offset: -2px; border-radius: 4px; }

.connect-mcp-hint--lead { margin: 0 0 6px; color: #374151; }
.connect-mcp-code-row--spaced { margin-bottom: 10px; }

.connect-mcp-install {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 12px;
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
