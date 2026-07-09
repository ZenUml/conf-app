// src/composables/agentLink/useAgentLinkSession.ts
//
// Vue composable tying together the Live Agent Link client state machine
// (agentLinkState.ts), the privileged bridge ops (bridgeOps.ts), the relay
// transport (relayClient.ts / relayUrl.ts), and the activity feed shown in
// the Fullscreen Connect rail
// (docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.1, §7,
// §10).
//
// Relay wiring (§4.3 handshake, §5.2) is OPTIONAL via `options.relay` — pass
// it once a real Forge-bridge + flag-on context exists (GenericViewer.vue's
// `mounted()` seam); omit it for the unwired placeholder instance
// (`created()` seam) and for standalone/dev/tests. When omitted,
// startConnect() keeps the local-only `pending-<ts>` placeholder token and
// onAgentConnected() stays the manually-driven seam it always was.

import { ref, type Ref } from 'vue'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type {
  MacroTypeValue,
  Surface,
  AgentLinkDisconnectReason,
} from '@/utils/analytics/catalog'
import {
  nextClientState,
  SETUP_TIMEOUT_MS,
  type AgentLinkClientState,
} from './agentLinkState'
import type { AgentLinkBridgeOps } from './bridgeOps'
import { createRelayClient, type RelayClient, type RelayStateEvent } from './relayClient'
import { agentLinkWsUrl, mintAgentLinkSession, type AgentLinkBoundContext } from './relayUrl'

export interface AgentLinkActivityEntry {
  summary: string
  at: number
}

// Injectable clock so the ~20s setup-timeout and duration/latency
// measurements are testable with fake timers instead of a real 20s wait.
export interface AgentLinkClock {
  now?: () => number
  setTimeout?: (handler: () => void, timeoutMs: number) => unknown
}

export interface UseAgentLinkSessionOptions {
  macroType: MacroTypeValue
  // Surface for the initial Connect click (small-macro `viewer` by default);
  // every later event in this composable fires from the Fullscreen rail.
  clickSurface?: Surface
  clock?: AgentLinkClock
  // Relay transport wiring (design §4.3 steps 2-5). Omitted entirely by the
  // unwired placeholder instance and by every existing test in this file —
  // startConnect() then falls back to the pre-relay placeholder-token
  // behavior untouched. `requestSession`/`connect` are injectable so this
  // path is unit-testable without a live relay; real callers omit them and
  // get mintAgentLinkSession (relayUrl.ts) / createRelayClient (relayClient.ts).
  relay?: {
    boundContext: AgentLinkBoundContext
    requestSession?: (ctx: AgentLinkBoundContext) => Promise<{ token: string }>
    connect?: (
      wsUrl: string,
      bridge: AgentLinkBridgeOps,
      onStateEvent: (event: RelayStateEvent) => void,
      onDiagramUpdated: (dsl: string) => void
    ) => RelayClient
  }
  // Fires after a relay-driven `update_diagram` op persists successfully
  // (see relayClient.ts's onDiagramUpdated doc comment). The host
  // (GenericViewer.vue) wires this to update its local diagram state the
  // SAME WAY the in-app code editor does — store.dispatch(getStoreUpdateAction(
  // diagramType), dsl) — so the macro re-renders live, without a reload.
  // `macroType` is this session's own bound diagram type, forwarded here so
  // the host doesn't need a separate lookup.
  onDiagramUpdated?: (dsl: string, macroType: MacroTypeValue) => void
}

export interface AgentLinkSessionApi {
  state: Ref<AgentLinkClientState>
  token: Ref<string | null>
  activityFeed: Ref<AgentLinkActivityEntry[]>
  startConnect(): void
  onAgentConnected(): void
  applyEdit(dsl: string, summary?: string): Promise<{ ok: boolean }>
  disconnect(reason?: AgentLinkDisconnectReason): void
}

export function useAgentLinkSession(
  bridgeOps: AgentLinkBridgeOps,
  options: UseAgentLinkSessionOptions
): AgentLinkSessionApi {
  const macroType = options.macroType
  const clickSurface = options.clickSurface ?? 'viewer'
  const now = options.clock?.now ?? (() => Date.now())
  const scheduleTimeout =
    options.clock?.setTimeout ??
    ((handler: () => void, ms: number) => setTimeout(handler, ms))

  const state = ref<AgentLinkClientState>('idle') as Ref<AgentLinkClientState>
  const token = ref<string | null>(null)
  const activityFeed = ref<AgentLinkActivityEntry[]>([]) as Ref<
    AgentLinkActivityEntry[]
  >

  let connectStartedAt: number | null = null
  let lastAppliedDsl = ''
  let editsCount = 0
  let relayClient: RelayClient | null = null

  // The wire protocol (relayClient.ts) has no dedicated "agent paired"
  // envelope — the only observable proxy that the agent has joined is it
  // sending its first 'op'. onAgentConnected() already no-ops once already
  // 'connected' (see below), so firing this on every subsequent op is safe.
  function handleRelayStateEvent(event: RelayStateEvent): void {
    if (event.type === 'op') onAgentConnected()
  }

  function teardownRelay(): void {
    relayClient?.close()
    relayClient = null
  }

  function startConnect(): void {
    // A click is a click regardless of current state — track it, then only
    // bootstrap a new session if it actually moved idle → waiting (a repeat
    // click while already waiting/connected is a no-op transition, so it
    // must not re-mint a token or reschedule the setup timer).
    trackAnalyticsEvent('agent_link_connect_clicked', {
      feature_area: 'agent_link',
      surface: clickSurface,
      macro_type: macroType,
    })
    const prev = state.value
    state.value = nextClientState(state.value, 'connect_clicked')
    if (prev !== 'idle' || state.value !== 'waiting') return

    connectStartedAt = now()
    editsCount = 0
    lastAppliedDsl = ''
    activityFeed.value = []
    teardownRelay()
    // Local placeholder marks "a session is pending" for the UI immediately
    // — mint/connect below is async and must not block this synchronous
    // idle -> waiting transition (existing callers/tests read state/token
    // right after this call returns).
    token.value = `pending-${connectStartedAt}`
    trackAnalyticsEvent('agent_link_session_created', {
      feature_area: 'agent_link',
      surface: 'fullscreen',
      macro_type: macroType,
    })
    // Self-loop per §7 — session_created doesn't leave `waiting`.
    state.value = nextClientState(state.value, 'session_created')

    // Relay handshake (design §4.3 steps 2-5): mint the real token, then
    // open this session's `peer=macro` channel. Omitted entirely when no
    // `relay` option is passed (unwired placeholder / standalone / dev /
    // every existing test here) — the local placeholder above is all those
    // callers get, unchanged from before this wiring existed.
    const relayOptions = options.relay
    if (relayOptions) {
      const requestSession = relayOptions.requestSession ?? mintAgentLinkSession
      const connect =
        relayOptions.connect ??
        ((
          wsUrl: string,
          bridge: AgentLinkBridgeOps,
          onStateEvent: (e: RelayStateEvent) => void,
          onDiagramUpdated: (dsl: string) => void
        ) => createRelayClient({ wsUrl, bridge, onStateEvent, onDiagramUpdated }))
      const startedForThisClick = connectStartedAt
      requestSession(relayOptions.boundContext)
        .then(({ token: realToken }) => {
          // A disconnect, or a NEWER startConnect() click, may have already
          // moved on while this mint was in flight — don't resurrect a
          // channel over a session that's no longer the current one.
          if (connectStartedAt !== startedForThisClick || state.value === 'closed') return
          token.value = realToken
          relayClient = connect(
            agentLinkWsUrl(realToken, relayOptions.boundContext),
            bridgeOps,
            handleRelayStateEvent,
            (dsl: string) => options.onDiagramUpdated?.(dsl, macroType)
          )
        })
        .catch((e) => {
          console.error('agent-link: failed to mint relay session', e)
        })
    }

    scheduleTimeout(() => {
      // Stale timer guard: if the state moved on (connected/closed) before
      // the timer fired, this is a no-op — the setup prompt is irrelevant.
      if (state.value !== 'waiting') return
      state.value = nextClientState(state.value, 'timeout')
      trackAnalyticsEvent('agent_link_setup_shown', {
        feature_area: 'agent_link',
        surface: 'fullscreen',
        macro_type: macroType,
      })
    }, SETUP_TIMEOUT_MS)
  }

  function onAgentConnected(): void {
    const prev = state.value
    state.value = nextClientState(state.value, 'agent_connected')
    if (prev === state.value) return // invalid from this state — no-op

    trackAnalyticsEvent('agent_link_agent_connected', {
      feature_area: 'agent_link',
      surface: 'fullscreen',
      macro_type: macroType,
      time_to_connect_ms:
        connectStartedAt != null ? now() - connectStartedAt : undefined,
    })
  }

  async function applyEdit(
    dsl: string,
    summary?: string
  ): Promise<{ ok: boolean }> {
    const result = await bridgeOps.writeDiagram(dsl, summary)
    if (result.ok) {
      editsCount += 1
      activityFeed.value = [
        ...activityFeed.value,
        { summary: summary?.trim() || 'diagram updated', at: now() },
      ]
      trackAnalyticsEvent('agent_link_edit_applied', {
        feature_area: 'agent_link',
        surface: 'fullscreen',
        macro_type: macroType,
        render_ok: result.rendered ?? true,
        dsl_len_delta: dsl.length - lastAppliedDsl.length,
      })
      lastAppliedDsl = dsl
    } else {
      trackAnalyticsEvent('agent_link_edit_failed', {
        feature_area: 'agent_link',
        surface: 'fullscreen',
        macro_type: macroType,
        reason: result.reason ?? 'write_failed',
      })
    }
    return { ok: result.ok }
  }

  function disconnect(reason: AgentLinkDisconnectReason = 'user'): void {
    const prev = state.value
    state.value = nextClientState(state.value, 'disconnect')
    if (prev === state.value) return // nothing was connected — no-op
    teardownRelay()

    trackAnalyticsEvent('agent_link_disconnected', {
      feature_area: 'agent_link',
      surface: 'fullscreen',
      macro_type: macroType,
      reason,
      session_duration_ms:
        connectStartedAt != null ? now() - connectStartedAt : undefined,
      edits_count: editsCount,
    })
  }

  return {
    state,
    token,
    activityFeed,
    startConnect,
    onAgentConnected,
    applyEdit,
    disconnect,
  }
}
