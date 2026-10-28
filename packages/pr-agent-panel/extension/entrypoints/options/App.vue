<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { LOCAL_HOST_ORIGIN, MCP_SERVER_NAME } from '@zenuml/pr-panel-shared'
import { browser } from 'wxt/browser'
import { buildTelemetryFrame } from '../../src/analytics/telemetry'
import type { HubStatusMessage } from '../../src/bridge/messages'
import { PanelPort } from '../../src/bridge/port'
import { DEFAULT_PREFS, getPrefs, onPrefsChanged, setPref, type Prefs } from '../../src/state/prefs'

const status = ref<HubStatusMessage>({ state: 'disabled' })
const prefs = reactive<Prefs>({ ...DEFAULT_PREFS })
const permissionGranted = ref(false)
const busy = ref(false)
const error = ref('')
const port = new PanelPort()
let unsubscribe: (() => void) | undefined

const statusText = computed(() => {
  const s = status.value
  if (prefs.mcpAccess !== 'enabled') return 'MCP access is disabled'
  if (s.needsPermission || !permissionGranted.value) return 'Waiting for permission to reach 127.0.0.1'
  switch (s.state) {
    case 'probing':
    case 'connecting':
      return 'Looking for the Hub…'
    case 'connected':
      return `Connected to the Hub on port ${s.port}${s.hubVersion ? ` (Hub ${s.hubVersion})` : ''}`
    case 'not_running':
      return s.reason === 'protocol_mismatch'
        ? 'Hub found, but it speaks a different protocol version. Update the Hub or the extension.'
        : 'Hub not running'
    default:
      return 'MCP access is disabled'
  }
})
const statusTone = computed(() => (status.value.state === 'connected' ? 'ok' : status.value.state === 'not_running' ? 'warn' : 'idle'))

const pluginCommand = 'claude --plugin-dir "$PWD/packages/pr-agent-panel/agent-plugin"'

async function refreshPermission() {
  permissionGranted.value = await browser.permissions.contains({ origins: [LOCAL_HOST_ORIGIN] })
}

async function enable() {
  error.value = ''
  busy.value = true
  try {
    // Must run inside the click handler: Chrome only grants optional permissions on a user gesture.
    const granted = await browser.permissions.request({ origins: [LOCAL_HOST_ORIGIN] })
    permissionGranted.value = granted
    if (!granted) {
      error.value = 'Permission not granted. The extension needs it to reach the Hub on 127.0.0.1.'
      return
    }
    await setPref('mcpAccess', 'enabled')
    port.post({ kind: 'reconnect' })
    port.send(buildTelemetryFrame('pr_panel_preferences_changed', { preference_key: 'mcp_access' }))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function disable() {
  await setPref('mcpAccess', 'disabled')
  port.post({ kind: 'setMcpAccess', value: 'disabled' })
}

onMounted(async () => {
  Object.assign(prefs, await getPrefs())
  await refreshPermission()
  unsubscribe = onPrefsChanged((c) => Object.assign(prefs, c))
  port.onStatus((s) => {
    status.value = s
    void refreshPermission()
  })
  port.connect()
})
onBeforeUnmount(() => {
  unsubscribe?.()
  port.disconnect()
})
</script>

<template>
  <main class="opt">
    <header>
      <h1>ZenUML PR Agent Panel</h1>
      <p class="lede">
        Shows the current finite PR review round beside its member pull requests. The local Hub keeps the round
        and lets your Claude Code or Codex session prepare evidence and confirm results.
      </p>
    </header>

    <section>
      <h2>Hub connection</h2>
      <p class="status" :data-tone="statusTone" data-testid="hub-status"><span class="dot"></span>{{ statusText }}</p>
      <div class="row">
        <button v-if="prefs.mcpAccess !== 'enabled' || !permissionGranted" type="button" class="primary" :disabled="busy" @click="enable">
          Enable MCP access
        </button>
        <button v-else type="button" @click="disable">Disable MCP access</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <p class="note">
        Enabling grants the extension permission to reach <code>{{ LOCAL_HOST_ORIGIN }}</code>. Until then it never probes
        local ports. The Hub listens on 127.0.0.1 only and accepts only browser-extension origins.
      </p>
    </section>

    <section>
      <h2>Set up your agent</h2>
      <ol>
        <li>
          Claude Code: start your session with the agent plugin (it brings the <code>{{ MCP_SERVER_NAME }}</code> MCP server,
          the lifecycle hooks and the <code>review-pr</code> skill):
          <pre><code>{{ pluginCommand }}</code></pre>
          Run it from the root of the conf-app checkout, or replace <code>$PWD</code> with that path.
        </li>
        <li>Codex: register the built <code>packages/pr-agent-panel/hub/dist/cli.mjs</code> as the <code>{{ MCP_SERVER_NAME }}</code> stdio MCP server.</li>
        <li>The first agent to connect starts the Hub. Ask it to prepare a finite review round; use the extension popup to continue after closing a tab.</li>
      </ol>
    </section>

    <section>
      <h2>Privacy</h2>
      <p class="note">
        The round and its progress stay on this machine. Preparing or refreshing a selected PR writes marked review
        material above its original GitHub body. Optional analytics receives counts and outcomes, never a repository,
        PR title, diff, or review text.
      </p>
    </section>
  </main>
</template>

<style>
:root { color-scheme: light dark; --fg: #1f2328; --muted: #59636e; --line: #d1d9e0; --bg: #ffffff; --sunken: #f6f8fa; --brand: #0969da; --ok: #1a7f37; --warn: #9a6700; }
@media (prefers-color-scheme: dark) { :root { --fg: #f0f6fc; --muted: #9198a1; --line: #3d444d; --bg: #0d1117; --sunken: #151b23; --brand: #4493f8; --ok: #3fb950; --warn: #d29922; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
.opt { max-width: 720px; margin: 0 auto; padding: 40px 24px 64px; display: flex; flex-direction: column; gap: 32px; }
h1 { font-size: 24px; margin: 0 0 8px; }
h2 { font-size: 16px; margin: 0 0 12px; }
.lede, .note { color: var(--muted); margin: 0; }
.note { font-size: 13px; margin-top: 12px; }
.row { display: flex; gap: 8px; }
button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--sunken); color: var(--fg); cursor: pointer; }
button.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
button:disabled { opacity: .6; cursor: default; }
.status { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-weight: 500; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.status[data-tone="ok"] .dot { background: var(--ok); }
.status[data-tone="warn"] .dot { background: var(--warn); }
.error { color: #cf222e; }
pre { background: var(--sunken); border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; overflow-x: auto; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
ol { padding-left: 20px; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.check { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
</style>
