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
  RENDER_SAFETY_TIMEOUT_MS,
  type AgentLinkClientState,
  type AgentLinkThinkingState,
} from './agentLinkState'
import type { AgentLinkBridgeOps } from './bridgeOps'
import {
  createRelayClient,
  type RelayClient,
  type RelayEditOutcome,
  type RelayStateEvent,
} from './relayClient'
import { agentLinkWsUrl, mintAgentLinkSession, type AgentLinkBoundContext } from './relayUrl'
import {
  persistSession,
  clearSession,
  subscribeToHandoff,
  subscribeToAnyHandoff,
  type AgentLinkHandoffSession,
  type AgentLinkHandoffThinking,
} from './sessionHandoff'

export interface AgentLinkActivityEntry {
  summary: string
  at: number
}

// Activity-feed copy for the perceived-latency lifecycle (Track F). Kept as
// constants so the relay owner (which builds these locally) and the Fullscreen
// hydrate path (which re-derives them from the handoff `thinking` flag)
// produce identical feed lines on both surfaces.
const THINKING_FEED_SUMMARY = 'Agent is updating the diagram…'
const EDIT_APPLIED_FEED_SUMMARY = 'Diagram updated'
const EDIT_FAILED_FEED_SUMMARY = '⚠ Agent edit did not apply'
const TIMEOUT_FEED_SUMMARY = '⚠ Agent stopped responding — timed out'

// How long the 'error' cue lingers on the render surface before auto-returning
// to 'idle'. Long enough to read, short enough to not nag. UI-only, so it
// lives here rather than in the pure state module. Exported for tests.
export const ERROR_FLASH_MS = 4000

// Injectable clock so the ~20s setup-timeout and duration/latency
// measurements are testable with fake timers instead of a real 20s wait.
export interface AgentLinkClock {
  now?: () => number
  setTimeout?: (handler: () => void, timeoutMs: number) => unknown
  // Cancels a handle returned by setTimeout — used to tear down the render
  // safety timer / error-flash timer when an op settles early. Defaults to the
  // global clearTimeout; injectable so fake-timer tests can assert teardown.
  clearTimeout?: (handle: unknown) => void
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
      onEditApplied: (outcome: RelayEditOutcome) => void,
      onPageRead: () => void
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
  // Perceived-latency "AI is thinking" surface state (charter §6 Track F),
  // orthogonal to `state` (a paired session is `connected` the whole time an
  // op is in flight). Drives the soft overlay on the diagram render surface
  // (ThinkingOverlay). Stays 'idle' on the flag-off / no-session path.
  thinkingState: Ref<AgentLinkThinkingState>
  startConnect(): void
  onAgentConnected(): void
  applyEdit(dsl: string, summary?: string): Promise<{ ok: boolean }>
  disconnect(reason?: AgentLinkDisconnectReason): void
  // Host (GenericViewer) calls this on $nextTick after it has applied an
  // agent-driven dsl update to its store — the earliest point the COMPLETE
  // new diagram has actually painted. Lets the composable measure a real
  // view-layer render_ms and clear the thinking overlay exactly when the new
  // diagram is on screen (never before — hard constraint: no partial preview).
  // No-op unless a thinking cycle is in progress.
  notifyRenderSettled(): void
  // Fullscreen-side counterpart to the inline instance's startConnect() —
  // see sessionHandoff.ts's header comment for the cross-iframe problem this
  // solves. Displays a session persisted by ANOTHER instance without
  // minting a new token or opening a second relay socket.
  hydrateFrom(session: AgentLinkHandoffSession): void
  // Reactive counterpart to a one-shot readSession()+hydrateFrom() call —
  // covers the mint-vs-mount RACE (2026-07-09 live spot-check): Fullscreen
  // can boot and read localStorage before the inline instance's async token
  // mint has persisted anything. Subscribes to the same-origin `storage`
  // event plus a bounded poll fallback (sessionHandoff.ts's
  // subscribeToHandoff) and calls hydrateFrom() the instant a session for
  // `pageId` shows up — a no-op if this instance is no longer idle by then.
  // Returns an unsubscribe function; callers MUST call it on unmount so the
  // listener/interval don't leak past the component's lifetime.
  watchForHandoff(pageId: string): () => void
  // pageId-less counterpart to watchForHandoff() (finding #4, 2026-07-09):
  // for a Fullscreen mount that has no resolved boundContext.pageId (e.g. no
  // apWrapper/Forge-bridge context was available), subscribes to ANY
  // `agentLinkSession:*` record via sessionHandoff.subscribeToAnyHandoff()
  // instead of one scoped to a specific pageId. Same hydrateFrom() guard
  // (idle-only, never mints/connects) and the same unsubscribe-on-unmount
  // contract as watchForHandoff().
  watchForAnyHandoff(): () => void
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
  const thinkingState = ref<AgentLinkThinkingState>('idle') as Ref<AgentLinkThinkingState>
  const activityFeed = ref<AgentLinkActivityEntry[]>([]) as Ref<
    AgentLinkActivityEntry[]
  >

  const clearTimer =
    options.clock?.clearTimeout ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  // Only set when a real relay context exists (see UseAgentLinkSessionOptions'
  // `relay` doc comment) — the same condition that gates the persistSession/
  // clearSession calls below, since a handoff record is keyed by pageId and
  // scoped to {cloudId, pageId, contentId}.
  const boundContext = options.relay?.boundContext ?? null

  let connectStartedAt: number | null = null
  let lastAppliedDsl = ''
  let editsCount = 0
  let relayClient: RelayClient | null = null

  // --- Track F perceived-latency ("AI is thinking") internals --------------
  // opReceivedAt: transport-stamped instant the in-flight update_diagram op
  //   arrived (RelayStateEvent.receivedAt) — the zero point for both
  //   ms_since_op_received and total_ms.
  // renderDispatchedAt: when the host was handed the new dsl (store dispatch)
  //   — the zero point for the real view-layer render_ms.
  // thinkingActive: true between beginThinking() and settleThinking(); guards
  //   against double-settle and against manual applyEdit()/stray host calls
  //   firing render_completed when no op is in flight.
  let opReceivedAt: number | null = null
  let renderDispatchedAt: number | null = null
  let thinkingActive = false
  let renderSafetyTimer: unknown = null
  let errorFlashTimer: unknown = null
  // Fullscreen-hydrate dedup: the newest handoff `thinking` value this
  // (hydrated) instance has already reflected, so the reactive watcher's
  // idempotent re-deliveries don't re-push feed lines / re-flash on every tick.
  let lastHydratedThinking: 'idle' | AgentLinkHandoffThinking = 'idle'
  // Fullscreen-side guard: the newest agent dsl this instance has already
  // mirrored into its own store via hydrateFrom(). The reactive handoff
  // watcher (watchForHandoff) re-delivers records idempotently, so without
  // this guard the same edit would re-dispatch on every storage tick. Only
  // used by the hydrated (Fullscreen) instance; the relay owner never
  // hydrates itself.
  let lastHydratedDsl: string | null = null

  // The wire protocol (relayClient.ts) has no dedicated "agent paired"
  // envelope — the only observable proxy that the agent has joined is it
  // sending its first 'op'. onAgentConnected() already no-ops once already
  // 'connected' (see below), so firing this on every subsequent op is safe.
  function handleRelayStateEvent(event: RelayStateEvent): void {
    if (event.type === 'op') {
      onAgentConnected()
      // Only an `update_diagram` op produces a render round-trip — reads
      // (read_page / read_diagram) change nothing on the surface, so lighting
      // a "diagram is changing" shimmer for them would be misleading. Scope
      // the perceived-latency state to the op that actually redraws.
      if (event.op === 'update_diagram') beginThinking(event.receivedAt)
    }
  }

  function teardownRelay(): void {
    relayClient?.close()
    relayClient = null
  }

  // Republishes the current session onto the handoff record carrying a
  // `thinking` cue, so the Fullscreen modal (a separate iframe that never
  // receives the op) can mirror the shimmer / error onto ITS surface. No-op
  // without a relay context (standalone/dev/tests) or before the real token
  // exists. Includes the last applied dsl so a late Fullscreen mount still
  // gets current diagram state; passing `thinking` undefined clears the cue.
  function publishThinking(thinking?: AgentLinkHandoffThinking): void {
    if (!boundContext || !token.value) return
    persistSession({
      ...boundContext,
      token: token.value,
      state: 'connected',
      ...(lastAppliedDsl ? { dsl: lastAppliedDsl } : {}),
      ...(thinking ? { thinking } : {}),
    })
  }

  function clearRenderSafetyTimer(): void {
    if (renderSafetyTimer != null) {
      clearTimer(renderSafetyTimer)
      renderSafetyTimer = null
    }
  }

  function clearErrorFlashTimer(): void {
    if (errorFlashTimer != null) {
      clearTimer(errorFlashTimer)
      errorFlashTimer = null
    }
  }

  function scheduleErrorFlashClear(): void {
    clearErrorFlashTimer()
    errorFlashTimer = scheduleTimeout(() => {
      errorFlashTimer = null
      if (thinkingState.value === 'error') thinkingState.value = 'idle'
      // Clear the handoff cue too so a Fullscreen opened later doesn't re-show
      // a stale error (no-op when this instance has no relay context).
      publishThinking(undefined)
    }, ERROR_FLASH_MS)
  }

  function resetThinking(): void {
    thinkingActive = false
    opReceivedAt = null
    renderDispatchedAt = null
    clearRenderSafetyTimer()
    clearErrorFlashTimer()
    thinkingState.value = 'idle'
  }

  // Op arrived (update_diagram) — show the "AI thinking" acknowledgment on the
  // render surface IMMEDIATELY, before the persist+render round-trip completes
  // (charter §6). Fires agent_link_first_feedback with the perceived-latency
  // number, and arms the safety backstop so a dropped socket can't hang.
  function beginThinking(opReceivedAtInput?: number): void {
    const shownAt = now()
    opReceivedAt =
      typeof opReceivedAtInput === 'number' ? opReceivedAtInput : shownAt
    renderDispatchedAt = null
    thinkingActive = true
    clearRenderSafetyTimer()
    clearErrorFlashTimer()
    thinkingState.value = 'thinking'
    activityFeed.value = [
      ...activityFeed.value,
      { summary: THINKING_FEED_SUMMARY, at: shownAt },
    ]
    publishThinking('thinking')
    trackAnalyticsEvent('agent_link_first_feedback', {
      feature_area: 'agent_link',
      surface: 'fullscreen',
      macro_type: macroType,
      ms_since_op_received: Math.max(0, shownAt - opReceivedAt),
    })
    renderSafetyTimer = scheduleTimeout(() => {
      renderSafetyTimer = null
      if (thinkingActive) settleThinking('timeout')
    }, RENDER_SAFETY_TIMEOUT_MS)
  }

  // Terminal end of a thinking cycle. Clears the overlay, fires
  // agent_link_render_completed with render/total timing + outcome, and on a
  // non-success shows a visible error cue that auto-returns to idle (never a
  // stuck shimmer). Idempotent: a no-op once the cycle already settled.
  function settleThinking(outcome: 'rendered' | 'failed' | 'timeout'): void {
    if (!thinkingActive) return
    thinkingActive = false
    clearRenderSafetyTimer()

    const settledAt = now()
    const renderMs =
      outcome === 'rendered' && renderDispatchedAt != null
        ? Math.max(0, settledAt - renderDispatchedAt)
        : undefined
    const totalMs =
      opReceivedAt != null ? Math.max(0, settledAt - opReceivedAt) : undefined

    trackAnalyticsEvent('agent_link_render_completed', {
      feature_area: 'agent_link',
      surface: 'fullscreen',
      macro_type: macroType,
      render_outcome: outcome,
      ...(renderMs != null ? { render_ms: renderMs } : {}),
      ...(totalMs != null ? { total_ms: totalMs } : {}),
    })

    opReceivedAt = null
    renderDispatchedAt = null

    if (outcome === 'rendered') {
      thinkingState.value = 'idle'
      // Success clears the handoff cue via the dsl republish (thinking omitted),
      // so no explicit publish here.
      return
    }

    thinkingState.value = 'error'
    // 'failed' already added its feed line in recordEditOutcome; 'timeout' has
    // no edit outcome of its own, so add its cue here.
    if (outcome === 'timeout') {
      activityFeed.value = [
        ...activityFeed.value,
        { summary: TIMEOUT_FEED_SUMMARY, at: now() },
      ]
    }
    publishThinking('error')
    scheduleErrorFlashClear()
  }

  function notifyRenderSettled(): void {
    if (!thinkingActive) return
    settleThinking('rendered')
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
      // Success does NOT clear the thinking overlay here — that happens in
      // notifyRenderSettled() (host $nextTick), so render_ms measures the real
      // paint and the shimmer clears exactly when the new diagram is visible.
    } else {
      // Visible error cue in the feed (charter §6 failure path: "feed entry at
      // minimum"), then clear the shimmer via settleThinking('failed').
      activityFeed.value = [
        ...activityFeed.value,
        { summary: EDIT_FAILED_FEED_SUMMARY, at: now() },
      ]
      trackAnalyticsEvent('agent_link_edit_failed', {
        feature_area: 'agent_link',
        surface: 'fullscreen',
        macro_type: macroType,
        reason: outcome.reason ?? 'write_failed',
      })
      settleThinking('failed')
    }
  }

  // Relay-driven `read_page` op completing (relayClient.ts's onPageRead) —
  // the only firing site for agent_link_page_read (was registered in
  // catalog.ts with no call site; audited 2026-07-09). No manual counterpart
  // exists (unlike edits, nothing in this app's own UI reads the page), so
  // this is simpler than recordEditOutcome: one callback, one event.
  function recordPageRead(): void {
    trackAnalyticsEvent('agent_link_page_read', {
      feature_area: 'agent_link',
      surface: 'fullscreen',
      macro_type: macroType,
    })
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
    resetThinking()
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
          onEditApplied: (outcome: RelayEditOutcome) => void,
          onPageRead: () => void
        ) => createRelayClient({ wsUrl, bridge, onStateEvent, onDiagramUpdated, onEditApplied, onPageRead }))
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
            (dsl: string) => {
              // Mark the instant the new COMPLETE dsl is handed to the store —
              // the zero point for the real view-layer render_ms measured when
              // the host confirms paint via notifyRenderSettled() (Track F).
              renderDispatchedAt = now()
              // Republishing the dsl with `thinking` OMITTED (idle) is what
              // clears the Fullscreen modal's shimmer on success: the new
              // complete diagram arrives and the "thinking" cue drops in the
              // same handoff write (charter §6: render once, complete dsl).
              // This instance (the inline relay owner) applies the edit to its
              // OWN store via the host callback below.
              if (boundContext && token.value) {
                persistSession({ ...boundContext, token: token.value, state: 'connected', dsl })
              }
              options.onDiagramUpdated?.(dsl, macroType)
            },
            recordEditOutcome,
            recordPageRead
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
    resetThinking()
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
    // --- session STATE (token + waiting/connected) -----------------------
    // Only a fresh (idle) instance may adopt the token/state — guards against
    // clobbering a session this very instance is itself driving (re-entrant
    // call, or a standalone/dev context where Fullscreen doesn't actually
    // boot a separate iframe/instance).
    if (state.value === 'idle') {
      token.value = session.token
      state.value = session.state
    } else if (
      state.value === 'waiting' &&
      session.state === 'connected' &&
      token.value === session.token
    ) {
      // Fullscreen may hydrate the relay owner's first handoff while it is
      // still waiting, then receive a later storage update after the owner
      // sees the agent's first op and persists `connected`. This UI-only
      // transition must not fire the agent_connected analytics a second time.
      state.value = nextClientState(state.value, 'agent_connected')
    }

    // --- diagram DSL (agent edit) ----------------------------------------
    // Independent of the state branch above, and NOT early-returned past:
    //  - a Fullscreen opened AFTER edits hydrates straight from 'idle' and
    //    still needs the latest dsl applied so it shows current state;
    //  - a live edit arrives as a dsl-only update while already 'connected'.
    // Display-only: this instance never owns the relay socket — it mirrors
    // the edit into its OWN Vue store via the host's onDiagramUpdated
    // (GenericViewer.applyAgentDiagramUpdate -> store.dispatch), exactly the
    // same seam the relay owner uses. lastHydratedDsl dedups the idempotent
    // re-deliveries from the reactive handoff watcher.
    if (typeof session.dsl === 'string' && session.dsl !== lastHydratedDsl) {
      // A live edit (this instance already had a prior dsl) vs. the initial
      // hydrate of a Fullscreen opened AFTER edits already happened. Only the
      // former is a fresh event worth a feed line; the initial hydrate is just
      // "show current state", not "an edit just landed".
      const isLiveUpdate = lastHydratedDsl !== null
      lastHydratedDsl = session.dsl
      options.onDiagramUpdated?.(session.dsl, macroType)
      if (isLiveUpdate) {
        activityFeed.value = [
          ...activityFeed.value,
          { summary: EDIT_APPLIED_FEED_SUMMARY, at: now() },
        ]
      }
    }

    // --- thinking cue (Track F cross-iframe mirror) ----------------------
    // The relay owner (inline macro) is the only instance that receives an op,
    // so it republishes `session.thinking` on the handoff. Mirror it onto THIS
    // (Fullscreen) surface — the shimmer/error must show here too (charter §6:
    // "both surfaces must show the state"). Deduped by lastHydratedThinking so
    // the reactive watcher's idempotent re-deliveries don't spam feed/flash.
    const incomingThinking: 'idle' | AgentLinkHandoffThinking =
      session.thinking ?? 'idle'
    if (incomingThinking !== lastHydratedThinking) {
      lastHydratedThinking = incomingThinking
      if (incomingThinking === 'thinking') {
        thinkingState.value = 'thinking'
        activityFeed.value = [
          ...activityFeed.value,
          { summary: THINKING_FEED_SUMMARY, at: now() },
        ]
      } else if (incomingThinking === 'error') {
        thinkingState.value = 'error'
        activityFeed.value = [
          ...activityFeed.value,
          { summary: EDIT_FAILED_FEED_SUMMARY, at: now() },
        ]
        scheduleErrorFlashClear()
      } else if (thinkingState.value === 'thinking') {
        // Op resolved (a new dsl usually arrived with this same record) — drop
        // the shimmer. Leave an 'error' cue alone; its own timer clears it.
        thinkingState.value = 'idle'
      }
    }
    // Deliberately does NOT call requestSession()/connect(): this instance
    // never mints a token or opens a relay socket for a hydrated session.
  }

  function watchForHandoff(pageId: string): () => void {
    return subscribeToHandoff(pageId, (session) => hydrateFrom(session))
  }

  function watchForAnyHandoff(): () => void {
    return subscribeToAnyHandoff((session) => hydrateFrom(session))
  }

  return {
    state,
    token,
    thinkingState,
    activityFeed,
    startConnect,
    onAgentConnected,
    applyEdit,
    disconnect,
    notifyRenderSettled,
    hydrateFrom,
    watchForHandoff,
    watchForAnyHandoff,
  }
}
