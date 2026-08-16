<template>
  <div class="agent-link-panel" :class="`agent-link-panel--${state}`" data-testid="agent-link-panel">
    <!-- Persistent link-status rail: browser <-> Worker <-> local agent.
         Shown for every in-session state (waiting/connected/suspended/timeout)
         so the user always sees which leg is up, without opening any details.
         Terminal notice states (closed/expired/already_linked/failed) render
         their own SessionNotice takeover instead — the session is over, there
         is no live leg left to show. -->
    <div v-if="showRail" class="agent-link-rail" data-testid="agent-link-rail">
      <span class="agent-link-rail__node agent-link-rail__node--up">Browser</span>
      <span class="agent-link-rail__seg" :class="`agent-link-rail__seg--${railBrowserWorker}`" aria-hidden="true"></span>
      <span class="agent-link-rail__node agent-link-rail__node--up">Worker</span>
      <span class="agent-link-rail__seg" :class="`agent-link-rail__seg--${railWorkerAgent}`" aria-hidden="true"></span>
      <span class="agent-link-rail__node" :class="`agent-link-rail__node--${railAgentNodeState}`">Agent</span>
    </div>

    <div class="agent-link-panel__scroll">
      <!-- waiting: paste prompt + copy + pulsing status + collapsed setup.
           Once the relay reports presence (progressStage != null — Task 5's
           useAgentLinkSession), the setup block is replaced by a staged
           ladder: the agent has already found the token, so re-showing the
           setup command would be confusing/redundant. Copy is honest about
           what each stage actually proves — see the `verified` row below. -->
      <template v-if="state === 'waiting'">
        <div data-testid="agent-link-waiting">
          <h3 class="agent-link-panel__heading">Edit with your agent</h3>

          <pre class="agent-link-panel__prompt" data-testid="agent-link-prompt">{{ promptText }}</pre>

          <button
            type="button"
            class="agent-link-panel__btn agent-link-panel__btn--primary"
            data-testid="agent-link-copy-prompt-btn"
            @click="onCopyPrompt"
          >{{ copyButtonLabel }}</button>

          <p class="agent-link-panel__status agent-link-panel__status--pulse" data-testid="agent-link-waiting-status">
            <span class="agent-link-panel__pulse-dot" aria-hidden="true"></span>
            Waiting for your agent to connect…
          </p>
          <!-- The idle/max window starts at mint (functions/agent-link/sessionToken.ts's
               lastActivityMs = issuedAtMs), not at first agent contact — so
               this counts down for real from the moment the token exists,
               matching SessionTtl's own default 600s (10-minute) bar. -->
          <SessionTtl :expires-at="expiresAt" :at-cap="atCap" />

          <ol v-if="progressStage != null" class="agent-link-panel__progress" data-testid="agent-link-progress">
            <li
              v-for="row in progressRows"
              :key="row.stage"
              class="agent-link-panel__progress-row"
              :class="{ 'agent-link-panel__progress-row--dim': row.rank > progressRank }"
            >{{ row.text }}</li>
          </ol>

          <details v-if="progressStage === null" class="agent-link-panel__disclosure" data-testid="agent-link-setup-disclosure">
            <summary>Connect your agent (each session uses a fresh command)</summary>
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
            :last-activity-at="lastActivityAt"
          />

          <!-- Task 7: relayClient.ts's own backoff gives up after ~15.5s
               (reconnect_failed) — the composable surfaces that as
               noticeReason:'connection_lost' instead of a new FSM state.
               Once given up, the amber banner must stop implying an ongoing
               retry (that was the eternal-"reconnecting…" bug) and offer the
               same manual Reconnect CTA the terminal notices use. -->
          <div v-if="noticeReason === 'connection_lost'" class="agent-link-banner agent-link-banner--warn">
            <!-- Static icon — deliberately NOT agent-link-banner__spin. That
                 class carries the infinite spin animation (this file's
                 .agent-link-banner__spin / .agent-link-banner--warn rules
                 below); using it here would visually imply an ongoing retry,
                 exactly the impression this notice exists to remove now that
                 relayClient.ts has genuinely given up. -->
            <svg class="agent-link-banner__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <div class="agent-link-banner__body">
              <h3 class="agent-link-banner__title agent-link-panel__heading--warning">Connection lost</h3>
              <p class="agent-link-banner__sub" data-testid="agent-link-suspended-status">
                We could not reconnect automatically. Your diagram is saved — reconnect to link a new agent session
              </p>
              <button
                type="button"
                class="agent-link-panel__btn agent-link-panel__btn--primary"
                data-testid="agent-link-suspended-reconnect-btn"
                @click="emit('revoke')"
              >Reconnect</button>
            </div>
          </div>
          <div v-else class="agent-link-banner agent-link-banner--warn">
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

      <!-- closed (Track G, terminal): explicit Disconnect. The diagram is
           saved; Reconnect mints a fresh session. -->
      <template v-else-if="state === 'closed'">
        <SessionNotice variant="closed" :diagram-title="diagramTitle" @reconnect="emit('reconnect')" />
      </template>

      <!-- expired (#314, terminal): the client-side TTL watchdog noticed the
           minted token's own lapse (the relay already 403s the agent
           server-side). SessionNotice already ships an "expired" variant
           (verbatim design-contract copy) — reuse it and the SAME reconnect
           emit the closed/failed notices use, rather than inventing a new
           bridge. -->
      <template v-else-if="state === 'expired'">
        <SessionNotice variant="expired" :diagram-title="diagramTitle" @reconnect="emit('reconnect')" />
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
        <SessionNotice variant="failed" :diagram-title="diagramTitle" @reconnect="emit('reconnect')" />
      </template>

      <!-- timeout: no agent seen yet — two labeled, independent options, each
           with its own retry hint directly beneath it (final-review fix: the
           old flat prompt→copy→setup→hint→hint stack left "Then paste the
           prompt again" reading as if it applied to the setup command shown
           just above it, when it actually applies to the prompt block). -->
      <template v-else-if="state === 'timeout'">
        <div data-testid="agent-link-timeout">
          <h3 class="agent-link-panel__heading agent-link-panel__heading--warning">No agent yet — first time here?</h3>
          <SessionTtl :expires-at="expiresAt" :at-cap="atCap" />

          <div class="agent-link-panel__option" data-testid="agent-link-option-prompt">
            <p class="agent-link-panel__option-label">Already have an agent connected? Paste this</p>
            <pre class="agent-link-panel__prompt" data-testid="agent-link-prompt">{{ promptText }}</pre>
            <button
              type="button"
              class="agent-link-panel__btn agent-link-panel__btn--primary"
              data-testid="agent-link-copy-prompt-btn"
              @click="onCopyPrompt"
            >{{ copyButtonLabel }}</button>
            <p class="agent-link-panel__hint" data-testid="agent-link-retry-hint">No response yet — paste it again. Each copy mints a fresh command.</p>
          </div>

          <div class="agent-link-panel__option" data-testid="agent-link-option-setup">
            <p class="agent-link-panel__option-label">First time? Run this in your terminal</p>
            <SetupInstructions />
            <p class="agent-link-panel__hint" data-testid="agent-link-timeout-hint">
              Pasted into a session that is already running? Restart it or run /mcp.
              A mistyped token cannot be detected server-side.
            </p>
          </div>

          <!-- Neither option above re-mints: pasting the prompt again reuses
               the same still-embedded token, and the setup command's token is
               baked in at render time too — if the session itself has gone
               bad (expired, wrong token copied, stale terminal), no amount of
               retrying either block helps. This is the one action that
               actually gets a new token: same revokeAndRelink() path as the
               connected/suspended rail's "Revoke & re-link". -->
          <button
            type="button"
            class="agent-link-panel__link"
            data-testid="agent-link-timeout-remint-btn"
            @click="emit('reconnect')"
          >Session not working? Get a fresh one</button>
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
import { agentLinkMcpUrl } from '@/composables/agentLink/relayUrl'
import AgentStatusHeader from './AgentStatusHeader.vue'
import SessionTtl from './SessionTtl.vue'
import RailActions from './RailActions.vue'
import SessionNotice from './SessionNotice.vue'

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
    //  - progressStage: Task 5's display-only handshake presence (null while
    //    unpaired) — drives the waiting-state ladder, see progressRows below.
    thinking?: AgentLinkThinkingState
    diagramTitle?: string
    clientName?: string
    progressStage?: 'initialized' | 'discovered' | 'verified' | 'working' | null
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
    // Task 7: 'connection_lost' once relayClient.ts's own reconnect backoff
    // has given up (or a socket error arrived while already down) — swaps the
    // 'suspended' banner from the "reconnecting…" spinner (still a genuinely
    // in-progress retry) to a persistent "Connection lost" notice with a
    // manual Reconnect CTA, instead of spinning forever.
    noticeReason?: 'connection_lost' | null
  }>(),
  { thinking: 'idle', diagramTitle: '', clientName: '', progressStage: null, expiresAt: null, lastActivityAt: null, lockExpiresAt: null, atCap: false, noticeReason: null }
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

// Rebuilt per session: the token rotates on every mint, and mcp.ts accepts
// credentials ONLY as an Authorization header (or ?token=) — a command
// without --header cannot authenticate. The trailing `claude -p` one-shot
// makes a real MCP client connect NOW (mcp add alone only writes config;
// the handshake would otherwise wait for the user's next session start).
const mcpAddCommand = computed(() => {
  const token = props.token ?? ''
  return [
    `claude mcp add --transport http conf-agent ${agentLinkMcpUrl()} \\`,
    `  --header "Authorization: Bearer ${token}" \\`,
    `&& claude -p "Using conf-agent, call get_status and report the diagram title."`,
  ].join('\n')
})

// The idle/max TTL is session metadata, not part of what the user pastes into
// their agent — it used to live inside promptText and got copy-pasted along
// with the chat instruction, which is noise for the agent and easy to miss
// for the human. Removed from promptText entirely; SessionTtl.vue now renders
// the real countdown in every state (waiting/timeout/connected) instead of a
// static string, since the idle/max window starts at mint, not at "connected"
// — sessionToken.ts's lastActivityMs is seeded to issuedAtMs, so the clock is
// already running while the panel still reads "Waiting for your agent".

// Shared "setup the connector" block used by both the waiting-state collapsed
// <details> and the always-expanded timeout state, so the copy and markup only
// exist once. The `claude mcp add` command is the single working setup path
// (the "Add to Cursor" button had no click handler and the "no-install
// bridge" link was href="#" — both dead, removed per design review).
const SetupInstructions = defineComponent({
  name: 'AgentLinkSetupInstructions',
  setup() {
    return () =>
      h('div', { class: 'agent-link-panel__setup', 'data-testid': 'agent-link-setup' }, [
        h(
          'pre',
          { class: 'agent-link-panel__command', 'data-testid': 'agent-link-setup-command' },
          mcpAddCommand.value
        ),
      ])
  },
})

// --- Waiting-state presence ladder --------------------------------------------
// Ranks mirror the relay's presence stages (agentLinkState.ts's progressStage
// on useAgentLinkSession). 'working' has no row of its own — the FSM flips the
// whole panel to the `connected` state once real work starts, so by the time
// 'working' could render here the ladder is already gone.
const PROGRESS_RANK: Record<'initialized' | 'discovered' | 'verified' | 'working', number> = {
  initialized: 1,
  discovered: 2,
  verified: 3,
  working: 4,
}

const progressRank = computed(() => (props.progressStage ? PROGRESS_RANK[props.progressStage] : 0))

// --- Persistent link-status rail -----------------------------------------
// Two independent legs, browser<->Worker and Worker<->agent. Rendered for
// every in-session state so the user always sees which leg is up — the
// terminal notice states (closed/expired/already_linked/failed) end the
// session outright and render their own SessionNotice takeover instead.
const RAIL_STATES: ReadonlyArray<AgentLinkClientState> = ['waiting', 'connected', 'suspended', 'timeout']
const showRail = computed(() => RAIL_STATES.includes(props.state))

// The browser<->Worker leg IS the relay WebSocket: 'suspended' is the FSM's
// own name for that socket being down (Track G), everything else in
// RAIL_STATES means it is open.
const railBrowserWorker = computed<'up' | 'down'>(() => (props.state === 'suspended' ? 'down' : 'up'))

// The Worker<->agent leg has no dedicated FSM state — it is read off
// progressStage (Task 5's display-only handshake presence) and 'connected'.
// 'suspended' drops both legs: once the relay socket itself is down, no
// agent traffic can reach it either, regardless of the last-known presence.
const railWorkerAgent = computed<'up' | 'down' | 'pending' | 'connecting'>(() => {
  if (props.state === 'suspended') return 'down'
  if (props.state === 'connected') return 'up'
  return props.progressStage === null ? 'pending' : 'connecting'
})

const railAgentNodeState = computed<'up' | 'down' | 'pending'>(() => {
  const leg = railWorkerAgent.value
  return leg === 'connecting' ? 'pending' : leg
})

// Copy is deliberately conservative: a `claude -p` one-shot handshake proves
// the relay + token round-trip, NOT that the interactive session is bound —
// so 'verified' says "Link verified", never anything that reads as "connected
// to your session". English throughout, matching every other string in this
// panel (final-review ruling, 2026-08-15).
const progressRows = computed(() => [
  { stage: 'initialized' as const, rank: PROGRESS_RANK.initialized, text: `✓ ${props.clientName || 'Agent'} connected` },
  { stage: 'discovered' as const, rank: PROGRESS_RANK.discovered, text: '✓ Diagram tools loaded' },
  { stage: 'verified' as const, rank: PROGRESS_RANK.verified, text: '✓ Link verified' },
])

const promptText = computed(() => {
  const sessionToken = props.token ?? ''
  return [
    'Connect to my ZenUML diagram via the conf-agent MCP.',
    `session: ${sessionToken}`,
  ].join('\n')
})

type CopyState = 'default' | 'copied' | 'failed'
const copyState = ref<CopyState>('default')
let copyRevertTimer: ReturnType<typeof setTimeout> | null = null

const copyButtonLabel = computed(() => {
  if (copyState.value === 'copied') return '✓ Copied'
  if (copyState.value === 'failed') return 'Copy failed — select the text above'
  return 'Copy prompt'
})

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
  if (s.startsWith('Reconnected')) return { ...entry, kind: 'normal', tone: 'ok', icon: ICONS.resume }
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

/* persistent link-status rail: browser <-> Worker <-> agent */
.agent-link-rail {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--agent-link-border);
  background: var(--agent-link-surface-muted);
  font-size: 11px;
  font-weight: 600;
  color: var(--agent-link-muted);
}

.agent-link-rail__node {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.agent-link-rail__node::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--agent-link-faint);
  flex: 0 0 auto;
}

.agent-link-rail__node--up::before { background: var(--agent-link-green); }
.agent-link-rail__node--down::before { background: var(--agent-link-amber); }
.agent-link-rail__node--pending::before { background: var(--agent-link-faint); }

.agent-link-rail__seg {
  flex: 1 1 16px;
  min-width: 16px;
  height: 2px;
  border-radius: 1px;
  background: var(--agent-link-faint);
}

.agent-link-rail__seg--up { background: var(--agent-link-green); }
.agent-link-rail__seg--down { background: var(--agent-link-amber); }
.agent-link-rail__seg--pending { background: var(--agent-link-faint); }
.agent-link-rail__seg--connecting {
  background: linear-gradient(90deg, var(--agent-link-blue) 0%, var(--agent-link-faint) 60%, var(--agent-link-blue) 100%);
  background-size: 200% 100%;
  animation: agent-link-rail-connecting 1.2s linear infinite;
}

@keyframes agent-link-rail-connecting {
  from { background-position: 0% 0; }
  to { background-position: -200% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .agent-link-rail__seg--connecting {
    animation: none;
  }
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
:deep(.agent-link-panel__command) {
  /* :deep() on .agent-link-panel__command only: SetupInstructions is a
     defineComponent+h() mini-component, not compiled <template> markup, so
     Vue's scoped-CSS attribute propagates only to its ROOT element
     (.agent-link-panel__setup) — the <pre> one level inside never carries
     the scope attribute, so a plain (non-deep) selector silently never
     matched it. Every rule in this block was dead code for that element
     until this changed — it only looked styled because of Tailwind's `pre`
     element reset happening to resemble the intended box. */
  margin: 0;
  /* min-width:0 defeats flexbox's automatic-minimum-size floor: as a flex
     item (this sits inside .agent-link-panel__setup and, for the setup
     command, an extra .agent-link-panel__option layer above that), a <pre>
     with visible overflow keeps its min-content width as a hard floor under
     `stretch` unless this is set — the URL in the setup command is long
     enough to hit that floor and run off the panel edge unwrapped. */
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--agent-link-border);
  background: var(--agent-link-surface-muted);
  font-family: "Menlo", ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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

.agent-link-panel__progress {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-link-panel__progress-row {
  font-size: 12px;
  color: var(--agent-link-ink);
}

.agent-link-panel__progress-row--dim {
  color: var(--agent-link-faint);
}

.agent-link-panel__option {
  display: flex;
  flex-direction: column;
  /* Same reasoning as .agent-link-panel__setup above — no flex-start here. */
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--agent-link-border);
  min-width: 0;
}

.agent-link-panel__option:first-of-type {
  padding-top: 0;
  border-top: none;
}

.agent-link-panel__option-label {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--agent-link-ink);
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
  /* NOT align-items: flex-start — that sizes children (the <pre> command
     block) to their content instead of stretching to the panel width, which
     defeats pre-wrap and lets the command run off the edge unwrapped. The
     button still self-aligns via its own .agent-link-panel__btn rule. */
  gap: 8px;
  margin-top: 8px;
  min-width: 0;
}

.agent-link-panel__divider {
  font-size: 11px;
  color: var(--agent-link-muted);
  text-transform: uppercase;
}

.agent-link-panel__link {
  display: block;
  margin-top: 4px;
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  font-size: 12px;
  color: var(--agent-link-muted);
  cursor: pointer;
  transition: color 200ms ease;
}
.agent-link-panel__link:hover {
  color: var(--agent-link-ink);
  text-decoration: underline;
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
.agent-link-banner__spin,
.agent-link-banner__icon {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  margin-top: 1px;
}
.agent-link-banner__spin {
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
