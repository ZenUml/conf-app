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
import {
  createRelayClient,
  type RelayClient,
  type RelayEditOutcome,
  type RelayStateEvent,
} from './relayClient'
import { agentLinkWsUrl, mintAgentLinkSession, type AgentLinkBoundContext } from './relayUrl'
import { persistSession, clearSession, type AgentLinkHandoffSession } from './sessionHandoff'

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
      onDiagramUpdated: (dsl: string) => void,
      onEditApplied: (outcome: RelayEditOutcome) => void
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
  // Fullscreen-side counterpart to the inline instance's startConnect() —
  // see sessionHandoff.ts's header comment for the cross-iframe problem this
  // solves. Displays a session persisted by ANOTHER instance without
  // minting a new token or opening a second relay socket.
  hydrateFrom(session: AgentLinkHandoffSession): void
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
  // Only set when a real relay context exists (see UseAgentLinkSessionOptions'
  // `relay` doc comment) — the same condition that gates the persistSession/
  // clearSession calls below, since a handoff record is keyed by pageId and
  // scoped to {cloudId, pageId, contentId}.
  const boundContext = options.relay?.boundContext ?? null

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

  // Single source of truth for "an edit happened" feed+analytics, shared by
  // both edit seams: the manual applyEdit() below, and relayClient.ts's
  // onEditApplied (a real agent's `update_diagram` op) via startConnect()'s
  // relay wiring further down. Without this sharing, relay-driven edits
  // would bypass the activity feed and agent_link_edit_applied/_failed —
  // exactly the gap this function closes.
  function recordEditOutcome(outcome: RelayEditOutcome): void {
    if (outcome.ok) {
      editsCount += 1
      activityFeed.value = [
        ...activityFeed.value,
        { summary: outcome.summary?.trim() || 'diagram updated', at: now() },
      ]
      trackAnalyticsEvent('agent_link_edit_applied', {
        feature_area: 'agent_link',
        surface: 'fullscreen',
        macro_type: macroType,
        render_ok: outcome.rendered ?? true,
        dsl_len_delta:
          typeof outcome.dsl === 'string'
            ? outcome.dsl.length - lastAppliedDsl.length
            : undefined,
      })
      if (typeof outcome.dsl === 'string') lastAppliedDsl = outcome.dsl
    } else {
      trackAnalyticsEvent('agent_link_edit_failed', {
        feature_area: 'agent_link',
        surface: 'fullscreen',
        macro_type: macroType,
        reason: outcome.reason ?? 'write_failed',
      })
    }
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
          onDiagramUpdated: (dsl: string) => void,
          onEditApplied: (outcome: RelayEditOutcome) => void
        ) => createRelayClient({ wsUrl, bridge, onStateEvent, onDiagramUpdated, onEditApplied }))
      const startedForThisClick = connectStartedAt
      requestSession(relayOptions.boundContext)
        .then(({ token: realToken }) => {
          // A disconnect, or a NEWER startConnect() click, may have already
          // moved on while this mint was in flight — don't resurrect a
          // channel over a session that's no longer the current one.
          if (connectStartedAt !== startedForThisClick || state.value === 'closed') return
          token.value = realToken
          // Hand the real token off to the (as-yet-idle) Fullscreen instance
          // — see sessionHandoff.ts. Only the real, relay-minted token is
          // persisted, never the local `pending-<ts>` placeholder: a
          // Fullscreen mount that reads nothing yet (this mint hasn't
          // resolved) falls back to today's blank-panel behavior, which is
          // strictly better than hydrating a token that will never resolve.
          if (boundContext) {
            persistSession({ ...boundContext, token: realToken, state: 'waiting' })
          }
          relayClient = connect(
            agentLinkWsUrl(realToken, relayOptions.boundContext),
            bridgeOps,
            handleRelayStateEvent,
            (dsl: string) => options.onDiagramUpdated?.(dsl, macroType),
            recordEditOutcome
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

    // Update the handoff record so a Fullscreen instance opened AFTER
    // pairing (e.g. closed then reopened) hydrates straight into
    // 'connected' instead of re-showing the (already-stale) waiting prompt.
    if (boundContext && token.value) {
      persistSession({ ...boundContext, token: token.value, state: 'connected' })
    }

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
    recordEditOutcome({
      ok: result.ok,
      dsl,
      summary,
      rendered: result.rendered,
      reason: result.reason,
    })
    return { ok: result.ok }
  }

  function disconnect(reason: AgentLinkDisconnectReason = 'user'): void {
    const prev = state.value
    state.value = nextClientState(state.value, 'disconnect')
    if (prev === state.value) return // nothing was connected — no-op
    teardownRelay()
    // Clear the handoff record so a future Fullscreen mount doesn't hydrate
    // a session that's already been disconnected here.
    if (boundContext) clearSession(boundContext.pageId)

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

  // Fullscreen-side hydration (sessionHandoff.ts): shows a session persisted
  // by ANOTHER (inline) useAgentLinkSession() instance, without minting a
  // new token or opening a rival relay socket — the instance that persisted
  // it keeps owning the one live WS (design §3 decision #8).
  function hydrateFrom(session: AgentLinkHandoffSession): void {
    // Only a fresh (idle) instance may be hydrated — guards against
    // clobbering a session this very instance is itself driving (re-entrant
    // call, or a standalone/dev context where Fullscreen doesn't actually
    // boot a separate iframe/instance).
    if (state.value !== 'idle') return
    token.value = session.token
    state.value = session.state
    // Deliberately does NOT call requestSession()/connect(): this instance
    // never mints a token or opens a relay socket for a hydrated session.
  }

  return {
    state,
    token,
    activityFeed,
    startConnect,
    onAgentConnected,
    applyEdit,
    disconnect,
    hydrateFrom,
  }
}
