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
import {
  agentLinkWsUrl,
  mintAgentLinkSession,
  type AgentLinkBoundContext,
  type MintSessionError,
} from './relayUrl'
import {
  persistSession,
  clearSession,
  readSession,
  subscribeToHandoff,
  subscribeToAnyHandoff,
  type AgentLinkHandoffSession,
  type AgentLinkHandoffThinking,
} from './sessionHandoff'
import { rememberAgentLinkClient } from './clientMemory'

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
// Track G (session lifecycle) feed copy — verbatim from Track H's design
// contract (h-design-bundle/ui_kits/agent-link/README.md's "Activity feed
// rows" table).
const SUSPENDED_FEED_SUMMARY = 'Connection paused'
const RESUMED_FEED_SUMMARY = 'Connection restored'

// PR1 status bus (spec 2026-07-13 §4.4/§5): guardrail rejects — previously
// invisible (the guard runs relay-side, the macro never sees the op) — get an
// honest feed row; deadline extensions fire a THROTTLED analytics event.
export const GUARDRAIL_REJECTED_FEED_SUMMARY = '⚠ Agent submitted an invalid edit — rejected'
export const EXTENDED_EVENT_THROTTLE_MS = 60_000
export const ACTIVITY_LINGER_MS = 5_000

// Track U discovery feed copy (design §3 "the user must be able to see
// everything the agent did, not only writes").
function readDiagramFeedSummary(title?: string): string {
  const t = title?.trim()
  return t ? `Read “${t}”` : 'Read a diagram'
}
function searchFeedSummary(query: string, hits: number): string {
  const q = query.trim()
  return `Searched “${q}” → ${hits} ${hits === 1 ? 'hit' : 'hits'}`
}
function listFeedSummary(scope: 'page' | 'space' | 'site', hits: number): string {
  const where = scope === 'page' ? 'on this page' : scope === 'space' ? 'in this space' : 'across the site'
  return `Listed diagrams ${where} → ${hits}`
}

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
    requestSession?: (ctx: AgentLinkBoundContext) => Promise<{ token: string; expiresInSec?: number }>
    connect?: (
      wsUrl: string,
      bridge: AgentLinkBridgeOps,
      onStateEvent: (event: RelayStateEvent) => void,
      onDiagramUpdated: (dsl: string) => void,
      onEditApplied: (outcome: RelayEditOutcome) => void,
      onPageRead: () => void,
      // Track U discovery activity (design §S3/S4/S5) — same seam as onPageRead.
      onDiagramRead?: (info: { title?: string; byContentId: boolean }) => void,
      onSearchPerformed?: (info: { query: string; hits: number }) => void,
      onListPerformed?: (info: { scope: 'page' | 'space' | 'site'; hits: number }) => void
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
  // Track H: absolute ms epoch when the relay-minted token expires, or null
  // when unknown (no relay context, or a reattached/hydrated session that
  // never carried an expiry). Drives the Fullscreen rail's TTL meter and the
  // toolbar link-status chip countdown. IS persisted onto the handoff record
  // (sessionHandoff.ts's `expiresAt` field) as of the bug 2 fix (spot-check
  // #3, 2026-07-09) — the original "never persisted" design left the
  // Fullscreen instance's own `expiresAt` permanently null, so its TTL meter
  // never lit up in the real cross-iframe topology.
  expiresAt: Ref<number | null>
  // Amendment D (honest already-linked countdown): when a mint was rejected
  // because another agent already holds this diagram's lock, the epoch ms at
  // which that lock releases — from the 409's lockExpiresAt — or null when the
  // rejection carried no lock time (or the state is not 'already_linked').
  // Drives SessionNotice's "expires in ~N min" copy.
  alreadyLinkedUntil: Ref<number | null>
  // Amendment F (sliding-TTL cap honesty): true once the DO's status envelope
  // reports the effective deadline is bounded by the 60-min absolute cap — at
  // which point further agent activity no longer extends it, so the "extends
  // while your agent works" hint must be suppressed (SessionTtl.vue).
  atCap: Ref<boolean>
  // Display-only timestamp of the newest relay op/status/edit signal. The
  // components derive the activity pulse/resting copy from this and
  // ACTIVITY_LINGER_MS; it does not drive the session FSM.
  lastActivityAt: Ref<number | null>
  activityFeed: Ref<AgentLinkActivityEntry[]>
  // Perceived-latency "AI is thinking" surface state (charter §6 Track F),
  // orthogonal to `state` (a paired session is `connected` the whole time an
  // op is in flight). Drives the soft overlay on the diagram render surface
  // (ThinkingOverlay). Stays 'idle' on the flag-off / no-session path.
  thinkingState: Ref<AgentLinkThinkingState>
  startConnect(): void
  // Track G: call once at mount from the INLINE (non-Fullscreen) macro
  // instance ONLY. Reattaches to a session this same macro already
  // persisted (sessionHandoff.ts) instead of resetting to 'idle' — see the
  // implementation's doc comment for why this matters beyond UX (the
  // per-contentId mint-exclusivity claim would otherwise 409 a fresh mint
  // against the very session being resumed). A no-op if idle-with-nothing-
  // persisted, already non-idle, or no relay context.
  attemptReattach(): void
  onAgentConnected(): void
  applyEdit(dsl: string, summary?: string): Promise<{ ok: boolean }>
  disconnect(reason?: AgentLinkDisconnectReason): void
  // "Revoke & re-link" (Track G, design decision #1's escape hatch): closes
  // the current session (same explicit-disconnect path as disconnect()) and
  // immediately mints a fresh token — one action instead of two. For a
  // 'suspended' session, or a dead/unresponsive first agent that never
  // explicitly disconnects.
  revokeAndRelink(): void
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
  const expiresAt = ref<number | null>(null)
  // Amendment D: epoch ms an existing lock releases, set from a mint 409's
  // lockExpiresAt (handleMintFailure), mirrored across the iframe via the
  // handoff record. Reset in startConnect's reset block and on teardown.
  const alreadyLinkedUntil = ref<number | null>(null)
  // Amendment F: whether the deadline is bounded by the absolute cap — set
  // from the DO status envelope's hitCap (mirrors lastHitCap), and hydrated
  // across the iframe via the handoff record.
  const atCap = ref(false)
  const lastActivityAt = ref<number | null>(null)
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

  // Shared by every persistSession() call site below (bug 2 fix, spot-check
  // #3): attaches the current bounded activity feed + known token TTL onto
  // EVERY handoff write, not just the dsl/thinking ones — this is what makes
  // discovery rows (search/list/read, which otherwise never touch the handoff
  // record at all) and the TTL meter reach the Fullscreen instance.
  // `feed` is always attached (even `[]` right after a reset) so the
  // Fullscreen rail's history always matches the owner's; `expiresAt` is
  // omitted while unknown, matching the existing dsl/thinking
  // present-only-when-known convention.
  function handoffFeedFields(): Pick<AgentLinkHandoffSession, 'feed'> &
    Partial<Pick<AgentLinkHandoffSession, 'expiresAt' | 'lastActivityAt' | 'hitCap'>> {
    return {
      feed: activityFeed.value,
      ...(expiresAt.value != null ? { expiresAt: expiresAt.value } : {}),
      ...(lastActivityAt.value != null ? { lastActivityAt: lastActivityAt.value } : {}),
      // Amendment F: only carried once actually capped — a fresh session
      // hydrates atCap=false and only flips it on a real capped status envelope.
      ...(atCap.value ? { hitCap: true } : {}),
    }
  }

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
  // #314: the client-side TTL watchdog. The relay independently 403s the
  // agent server-side once the minted token's idle window (10 min)
  // lapses, but nothing previously told THIS FSM to leave whatever
  // live/pending state it was in — the rail stayed stuck showing a connected
  // variant with the countdown pinned at "0:00" forever. Scheduled against
  // `expiresAt` (scheduleExpiry()) any time that value is set — the mint
  // success path in startConnect() and the cross-iframe hydrate path in
  // hydrateFrom() — and cleared whenever a fresh/explicit teardown makes the
  // pending deadline moot (startConnect()'s reset, disconnect()).
  let expiryTimer: unknown = null
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
  // Track G (session lifecycle/suspend-resume): the instant the relay socket
  // was last observed to drop unexpectedly (an ACCIDENTAL close while
  // 'connected' — see handleRelayStateEvent's 'close' branch), so a
  // subsequent successful reconnect can measure resume_latency_ms for
  // agent_link_session_resumed. Null whenever not currently suspended.
  let suspendedAt: number | null = null
  // PR1 sliding-TTL status bus (spec 2026-07-13 §4.4). lastHitCap: the newest
  // `hitCap` seen on a status envelope — true once the effective deadline is
  // bounded by the 60-min absolute cap rather than the 10-min idle window;
  // read back when firing agent_link_session_extended and to colour
  // handleExpired's expiry_cause (absolute_cap vs idle). lastExtendedFiredAt:
  // the clock instant the last agent_link_session_extended fired, throttling
  // the event to at most once per EXTENDED_EVENT_THROTTLE_MS (0 means the
  // FIRST real extension always fires — 0 is >60s before any real clock).
  let lastHitCap = false
  let lastExtendedFiredAt = 0

  // The wire protocol (relayClient.ts) has no dedicated "agent paired"
  // envelope — the only observable proxy that the agent has joined is it
  // sending its first 'op'. onAgentConnected() already no-ops once already
  // 'connected' (see below), so firing this on every subsequent op is safe.
  function handleRelayStateEvent(event: RelayStateEvent): void {
    // Record literal browser/retry signals only. The WebSocket error message
    // is intentionally excluded: browsers may include implementation details
    // or a URL, and neither is needed for this low-cardinality lifecycle.
    // The existing suspended/resumed events below remain the evidence that a
    // user-visible pause actually occurred.
    if (event.type === 'error') {
      if (event.unexpected === true) {
        trackAnalyticsEvent('agent_link_connection_diagnostic', {
          feature_area: 'agent_link',
          surface: 'fullscreen',
          macro_type: macroType,
          diagnostic_origin: 'error',
          reconnect_attempt: event.reconnectAttempt ?? 0,
        })
      }
      return
    }

    if (event.type === 'reconnecting') {
      trackAnalyticsEvent('agent_link_connection_diagnostic', {
        feature_area: 'agent_link',
        surface: 'fullscreen',
        macro_type: macroType,
        diagnostic_origin: 'reconnect_attempt',
        reconnect_attempt: event.attempt,
      })
      return
    }

    if (event.type === 'reconnect_failed') {
      trackAnalyticsEvent('agent_link_connection_diagnostic', {
        feature_area: 'agent_link',
        surface: 'fullscreen',
        macro_type: macroType,
        diagnostic_origin: 'reconnect_exhausted',
        reconnect_attempt: event.attempt ?? 0,
        reconnect_outcome: 'exhausted',
      })
      if (state.value === 'suspended') {
        state.value = nextClientState(state.value, 'reconnect_failed')
        if (boundContext && token.value) {
          persistSession({
            ...boundContext,
            token: token.value,
            state: 'recovery_exhausted',
            ...handoffFeedFields(),
          })
        }
        return
      }
      return
    }

    if (event.type === 'status') {
      lastActivityAt.value = now()
      // Relay-originated status bus (Task 7 → spec §4.4): mirror the DO's
      // authoritative sliding-TTL deadline — never compute our own (spec §4).
      // hitCap feeds expiry_cause later (absolute_cap vs idle). Amendment F:
      // also mirror it onto the reactive `atCap` ref so SessionTtl can suppress
      // the "extends while your agent works" hint once bumps stop extending.
      if (typeof event.hitCap === 'boolean') {
        lastHitCap = event.hitCap
        atCap.value = event.hitCap
      }
      if (typeof event.expiresAt === 'number') {
        const prev = expiresAt.value
        expiresAt.value = event.expiresAt
        // Re-arm the #314 watchdog against the fresh deadline — scheduleExpiry
        // clears the prior handle first, so a pushed-forward deadline actually
        // extends the session's life (and a pulled-in one shortens it).
        scheduleExpiry()
        // A genuine forward extension, throttled to one analytics event per
        // window — a lively session slides its TTL on every op, and we don't
        // want an _extended firehose (spec §5). A shortened/equal deadline
        // (e.g. the absolute cap pulling in) is not an "extension".
        if (
          prev != null &&
          event.expiresAt > prev &&
          now() - lastExtendedFiredAt >= EXTENDED_EVENT_THROTTLE_MS
        ) {
          lastExtendedFiredAt = now()
          trackAnalyticsEvent('agent_link_session_extended', {
            feature_area: 'agent_link',
            surface: 'fullscreen',
            macro_type: macroType,
            expires_in_sec: Math.max(0, Math.round((event.expiresAt - now()) / 1000)),
            hit_cap: lastHitCap,
          })
        }
      }
      if (event.activity?.type === 'guardrail_rejected') {
        // A guardrail reject is otherwise invisible to the macro — the guard
        // runs relay-side and the offending op is never forwarded — so give it
        // an honest feed row (spec §4.4/§5).
        activityFeed.value = [
          ...activityFeed.value,
          { summary: GUARDRAIL_REJECTED_FEED_SUMMARY, at: now() },
        ]
      }
      if (event.activity?.type === 'client_identified') {
        // mcp.ts already reduced initialize.clientInfo to a safe display
        // label. Normalize again at the storage edge and retain no raw MCP
        // identity, version, token, endpoint or internal session identifier.
        rememberAgentLinkClient(event.activity.detail, now())
      }
      if (
        event.activity?.type === 'protocol_incompatible' &&
        (state.value === 'waiting' || state.value === 'timeout')
      ) {
        state.value = nextClientState(state.value, 'protocol_incompatible')
        if (boundContext && token.value) {
          persistSession({
            ...boundContext,
            token: token.value,
            state: 'incompatible',
            ...handoffFeedFields(),
          })
        }
        // Do not let the generic status republisher overwrite this terminal
        // state with its connected handoff record.
        return
      }
      // Republish so a separate Fullscreen mirror gets the new deadline + feed
      // row through the existing handoff path (no new plumbing — spec §4.4);
      // currentThinkingFlag() preserves any genuinely in-flight thinking cue.
      publishThinking(currentThinkingFlag())
      return
    }

    if (event.type === 'op') {
      lastActivityAt.value = now()
      onAgentConnected()
      // Only an `update_diagram` op produces a render round-trip — reads
      // (read_page / read_diagram) change nothing on the surface, so lighting
      // a "diagram is changing" shimmer for them would be misleading. Scope
      // the perceived-latency state to the op that actually redraws.
      if (event.op === 'update_diagram') beginThinking(event.receivedAt)
      return
    }

    // Track G: the relay socket dropped WITHOUT us calling disconnect()
    // ourselves — relayClient.ts already retries-by-token underneath
    // (scheduleReconnect), so this only updates the UI/handoff/analytics
    // layer; the transport itself doesn't need driving here. Scoped to
    // 'connected' only — a drop while 'waiting'/'timeout' (the agent never
    // paired yet) isn't a meaningful interruption to surface as "paused".
    if (event.type === 'close') {
      if (event.unexpected === true) {
        trackAnalyticsEvent('agent_link_connection_diagnostic', {
          feature_area: 'agent_link',
          surface: 'fullscreen',
          macro_type: macroType,
          diagnostic_origin: 'close',
          reconnect_attempt: event.reconnectAttempt ?? 0,
          ...(typeof event.code === 'number' ? { close_code: event.code } : {}),
          ...(typeof event.wasClean === 'boolean' ? { was_clean: event.wasClean } : {}),
        })
      }
      // close()/disconnect() can still cause an onclose callback. That signal
      // is intentional and terminal, even if it races an outer state update.
      if (event.unexpected === false) return
      if (state.value !== 'connected') return
      suspendedAt = now()
      state.value = nextClientState(state.value, 'ws_drop')
      activityFeed.value = [...activityFeed.value, { summary: SUSPENDED_FEED_SUMMARY, at: now() }]
      if (boundContext && token.value) {
        persistSession({ ...boundContext, token: token.value, state: 'suspended', ...handoffFeedFields() })
      }
      trackAnalyticsEvent('agent_link_session_suspended', {
        feature_area: 'agent_link',
        surface: 'fullscreen',
        macro_type: macroType,
        reason: 'ws_drop',
      })
      return
    }

    // A same-token reconnect succeeded (relayClient.ts's own scheduleReconnect
    // opened a fresh socket to the same wsUrl and the relay's DO accepted the
    // reattach — see AgentLinkSession.ts's fetch()). Only meaningful coming
    // FROM 'suspended': the very first 'open' (initial connect) fires here
    // too but is a no-op since state is still 'waiting' at that point.
    if (event.type === 'open') {
      if ((event.reconnectAttempt ?? 0) > 0) {
        trackAnalyticsEvent('agent_link_connection_diagnostic', {
          feature_area: 'agent_link',
          surface: 'fullscreen',
          macro_type: macroType,
          diagnostic_origin: 'reconnect_succeeded',
          reconnect_attempt: event.reconnectAttempt,
          reconnect_outcome: 'succeeded',
        })
      }
      if (state.value !== 'suspended') return
      const resumeLatencyMs = suspendedAt != null ? Math.max(0, now() - suspendedAt) : undefined
      suspendedAt = null
      state.value = nextClientState(state.value, 'resumed')
      activityFeed.value = [...activityFeed.value, { summary: RESUMED_FEED_SUMMARY, at: now() }]
      if (boundContext && token.value) {
        persistSession({
          ...boundContext,
          token: token.value,
          state: 'connected',
          ...(lastAppliedDsl ? { dsl: lastAppliedDsl } : {}),
          ...handoffFeedFields(),
        })
      }
      trackAnalyticsEvent('agent_link_session_resumed', {
        feature_area: 'agent_link',
        surface: 'fullscreen',
        macro_type: macroType,
        ...(resumeLatencyMs != null ? { resume_latency_ms: resumeLatencyMs } : {}),
      })
    }
  }

  function teardownRelay(): void {
    relayClient?.close()
    relayClient = null
  }

  // Opens the relay WS channel for `sessionToken` and wires the shared
  // callbacks — factored out of startConnect()'s requestSession().then(...)
  // so attemptReattach() (Track G: reattaching to an EXISTING token on a
  // fresh mount, no mint) can share the exact same wiring instead of
  // duplicating it.
  function openRelayChannel(
    sessionToken: string,
    relayOptions: NonNullable<UseAgentLinkSessionOptions['relay']>
  ): void {
    const connect =
      relayOptions.connect ??
      ((
        wsUrl: string,
        bridge: AgentLinkBridgeOps,
        onStateEvent: (e: RelayStateEvent) => void,
        onDiagramUpdated: (dsl: string) => void,
        onEditApplied: (outcome: RelayEditOutcome) => void,
        onPageRead: () => void,
        onDiagramRead?: (info: { title?: string; byContentId: boolean }) => void,
        onSearchPerformed?: (info: { query: string; hits: number }) => void,
        onListPerformed?: (info: { scope: 'page' | 'space' | 'site'; hits: number }) => void
      ) =>
        createRelayClient({
          wsUrl,
          bridge,
          onStateEvent,
          onDiagramUpdated,
          onEditApplied,
          onPageRead,
          onDiagramRead,
          onSearchPerformed,
          onListPerformed,
        }))

    relayClient = connect(
      agentLinkWsUrl(sessionToken, relayOptions.boundContext),
      bridgeOps,
      handleRelayStateEvent,
      (dsl: string) => {
        // Mark the instant the new COMPLETE dsl is handed to the store — the
        // zero point for the real view-layer render_ms measured when the
        // host confirms paint via notifyRenderSettled() (Track F).
        renderDispatchedAt = now()
        // Republishing the dsl with `thinking` OMITTED (idle) is what clears
        // the Fullscreen modal's shimmer on success: the new complete diagram
        // arrives and the "thinking" cue drops in the same handoff write
        // (charter §6: render once, complete dsl). This instance (the inline
        // relay owner) applies the edit to its OWN store via the host
        // callback below.
        if (boundContext && token.value) {
          persistSession({ ...boundContext, token: token.value, state: 'connected', dsl, ...handoffFeedFields() })
        }
        options.onDiagramUpdated?.(dsl, macroType)
      },
      recordEditOutcome,
      recordPageRead,
      recordDiagramRead,
      recordSearchPerformed,
      recordListPerformed
    )
  }

  // Republishes the current session onto the handoff record carrying a
  // `thinking` cue, so the Fullscreen modal (a separate iframe that never
  // receives the op) can mirror the shimmer / error onto ITS surface. No-op
  // without a relay context (standalone/dev/tests) or before the real token
  // exists. Includes the last applied dsl so a late Fullscreen mount still
  // gets current diagram state; passing `thinking` undefined clears the cue.
  // Also doubles as the generic "republish feed + TTL" seam (bug 2 fix): the
  // Track U discovery recorders below call this via currentThinkingFlag()
  // (never a bare `undefined`) so a search/list/read row reaches the handoff
  // record too, without erasing a thinking/error cue that's genuinely still
  // in flight from a concurrently-interleaved update_diagram op.
  function publishThinking(thinking?: AgentLinkHandoffThinking): void {
    if (!boundContext || !token.value) return
    persistSession({
      ...boundContext,
      token: token.value,
      state: 'connected',
      ...(lastAppliedDsl ? { dsl: lastAppliedDsl } : {}),
      ...(thinking ? { thinking } : {}),
      ...handoffFeedFields(),
    })
  }

  // The three existing publishThinking() call sites (beginThinking,
  // settleThinking's failure path, scheduleErrorFlashClear's timer) already
  // know the exact thinking value they want to set from their own local
  // control flow. The Track U discovery recorders (recordDiagramRead/
  // recordSearchPerformed/recordListPerformed) don't — they just want to
  // republish the feed without changing whatever thinking cue is currently
  // shown, so they read it back off `thinkingState` instead. relayClient.ts's
  // handleOp is fire-and-forget (`void handleOp(envelope)`), so a discovery op
  // COULD in principle interleave with an in-flight update_diagram — this
  // guards against that rare case clobbering the cue.
  function currentThinkingFlag(): AgentLinkHandoffThinking | undefined {
    return thinkingState.value === 'thinking' || thinkingState.value === 'error'
      ? thinkingState.value
      : undefined
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

  function clearExpiryTimer(): void {
    if (expiryTimer != null) {
      clearTimer(expiryTimer)
      expiryTimer = null
    }
  }

  // #314: (re)arms the TTL watchdog against the current `expiresAt`. A no-op
  // when the expiry is unknown (no relay context, or a reattached/hydrated
  // session that never carried one — the meter/chip just don't show a
  // countdown in that case either, same as today). If the deadline has
  // already passed by the time this runs (e.g. a Fullscreen mount hydrating a
  // record whose TTL lapsed while it was closed), fire immediately rather
  // than scheduling a negative/zero-delay timer.
  function scheduleExpiry(): void {
    clearExpiryTimer()
    if (expiresAt.value == null) return
    const ms = expiresAt.value - now()
    if (ms <= 0) {
      handleExpired()
      return
    }
    expiryTimer = scheduleTimeout(handleExpired, ms)
  }

  // Terminal end of a session's token lifetime, fired by scheduleExpiry()'s
  // timer. The relay already 403s the agent server-side the instant the token
  // lapses ("Session token expired") — this is the CLIENT noticing the same
  // deadline on its own clock and finally giving the FSM an event to leave
  // whatever live/pending state it was stuck in (#314's actual bug: nothing
  // previously watched `expiresAt`, so the rail stayed on a live variant with
  // the countdown pinned at "0:00" indefinitely).
  function handleExpired(): void {
    expiryTimer = null
    const prev = state.value
    const next = nextClientState(prev, 'expired')
    if (next === prev) return // idle/closed/already_linked/failed — no live session to expire
    state.value = next
    resetThinking()
    // expiresAt is intentionally LEFT AS-IS: the rail's "Expired" notice still
    // wants to know when the dead token would have lapsed, and nulling it here
    // buys nothing (SessionNotice's expired variant doesn't render a
    // countdown off it).
    teardownRelay()
    if (boundContext && token.value) {
      persistSession({
        ...boundContext,
        token: token.value,
        state: 'expired',
        ...handoffFeedFields(),
      })
    }
    // Analytics fire from the RELAY OWNER only (the instance that minted or
    // reattached — `connectStartedAt` is set there and never on a purely
    // display-only Fullscreen hydrate). Without this gate, when Fullscreen is
    // open at the deadline BOTH instances' independently-armed watchdogs fire
    // handleExpired() and the event double-counts — the same single-fire
    // discipline the suspended/resumed hydrate mirrors keep. The UI transition
    // above is deliberately NOT gated: both surfaces must show 'expired'.
    if (connectStartedAt != null) {
      trackAnalyticsEvent('agent_link_session_expired', {
        feature_area: 'agent_link',
        surface: clickSurface,
        macro_type: macroType,
        had_agent_connected: prev === 'connected' || prev === 'suspended',
        session_duration_ms: now() - connectStartedAt,
        edits_count: editsCount,
        // PR1 sliding TTL (spec §5/§7): the DO's last-seen cap flag tells the
        // funnel apart a session that hit its 60-min lifetime cap (absolute_cap)
        // from one that simply idled out its 10-min window (idle).
        expiry_cause: lastHitCap ? 'absolute_cap' : 'idle',
        hit_cap: lastHitCap,
      })
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
    lastActivityAt.value = now()
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
      // Republish so the "diagram updated" row just pushed above (added AFTER
      // the dsl-carrying persistSession() call in openRelayChannel's
      // onDiagramUpdated wiring) reaches the handoff record promptly rather
      // than waiting for some later, unrelated persist (bug 2 fix). Passes
      // `undefined` explicitly (not currentThinkingFlag()) — this fires
      // immediately after that dsl republish already cleared `thinking` for
      // this same edit, and thinkingState itself isn't cleared until
      // notifyRenderSettled() confirms paint, so reading it here would
      // incorrectly re-show a cue that was just intentionally dropped.
      publishThinking(undefined)
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
    // PR2 (final review 2026-07-13): republish so the Fullscreen mirror's
    // lastActivityAt updates on page reads too — the other three recorders
    // already do this; without it, page_read was the one op whose activity
    // only reached the mirror via the server's status envelope.
    publishThinking(currentThinkingFlag())
    trackAnalyticsEvent('agent_link_page_read', {
      feature_area: 'agent_link',
      surface: 'fullscreen',
      macro_type: macroType,
    })
  }

  // --- Track U discovery (design §S3/S4/S5) --------------------------------
  // Each discovery op the agent runs appends an activity-feed row (the user
  // sees everything) AND fires its Mixpanel event. Same one-callback-one-event
  // shape as recordPageRead. The raw query never reaches analytics — only its
  // length (privacy); the feed row (local UI) does show it.
  //
  // Bug 2 fix (spot-check #3): these three previously only touched the LOCAL
  // activityFeed ref, never the handoff record — so a discovered/searched/
  // listed row was visible on the inline instance's own rail but never
  // reached a separate Fullscreen instance no matter how many the agent ran.
  // publishThinking() republishes the (now feed-carrying) handoff record;
  // currentThinkingFlag() preserves whatever thinking cue is genuinely active
  // instead of clobbering it (see currentThinkingFlag's own comment).
  function recordDiagramRead(info: { title?: string; byContentId: boolean }): void {
    activityFeed.value = [
      ...activityFeed.value,
      { summary: readDiagramFeedSummary(info.title), at: now() },
    ]
    publishThinking(currentThinkingFlag())
    trackAnalyticsEvent('agent_link_diagram_read', {
      feature_area: 'agent_link',
      surface: 'fullscreen',
      macro_type: macroType,
      by_content_id: info.byContentId,
    })
  }

  function recordSearchPerformed(info: { query: string; hits: number }): void {
    activityFeed.value = [
      ...activityFeed.value,
      { summary: searchFeedSummary(info.query, info.hits), at: now() },
    ]
    publishThinking(currentThinkingFlag())
    trackAnalyticsEvent('agent_link_search_performed', {
      feature_area: 'agent_link',
      surface: 'fullscreen',
      macro_type: macroType,
      query_len: info.query.length,
      hits: info.hits,
    })
  }

  function recordListPerformed(info: { scope: 'page' | 'space' | 'site'; hits: number }): void {
    activityFeed.value = [
      ...activityFeed.value,
      { summary: listFeedSummary(info.scope, info.hits), at: now() },
    ]
    publishThinking(currentThinkingFlag())
    trackAnalyticsEvent('agent_link_list_performed', {
      feature_area: 'agent_link',
      surface: 'fullscreen',
      macro_type: macroType,
      list_scope: info.scope,
      hits: info.hits,
    })
  }

  function isAlreadyLinkedMintFailure(error: unknown): boolean {
    const e = error as Partial<MintSessionError> & { message?: string }
    return (
      e.status === 409 ||
      e.error === 'diagram_already_linked' ||
      e.message?.includes('HTTP 409') === true ||
      e.message?.includes('diagram_already_linked') === true
    )
  }

  function handleMintFailure(error: unknown, startedForThisClick: number | null): void {
    console.error('agent-link: failed to mint relay session', error)
    if (connectStartedAt !== startedForThisClick || state.value === 'closed') return

    const alreadyLinked = isAlreadyLinkedMintFailure(error)
    const handoffToken = token.value ?? `pending-${startedForThisClick ?? now()}`
    token.value = null
    expiresAt.value = null
    const e = error as Partial<MintSessionError> & { message?: string }
    // Amendment D: adopt the 409's lock release time (if any) so SessionNotice
    // can show an honest countdown; null for a non-already-linked failure or an
    // already-linked failure that carried no lockExpiresAt.
    alreadyLinkedUntil.value =
      alreadyLinked && typeof e.lockExpiresAt === 'number' ? e.lockExpiresAt : null
    state.value = nextClientState(state.value, alreadyLinked ? 'mint_rejected' : 'mint_failed')
    if (boundContext) {
      persistSession({
        ...boundContext,
        token: handoffToken,
        state: alreadyLinked ? 'already_linked' : 'failed',
        ...handoffFeedFields(),
        // Amendment D: mirror the lock time so a display-only Fullscreen
        // instance can show the same honest countdown via hydrateFrom.
        ...(alreadyLinkedUntil.value != null ? { lockExpiresAt: alreadyLinkedUntil.value } : {}),
      })
    }

    const reason = alreadyLinked ? 'diagram_already_linked' : 'session_mint_failed'
    trackAnalyticsEvent('agent_link_edit_failed', {
      feature_area: 'agent_link',
      surface: 'fullscreen',
      macro_type: macroType,
      reason,
      error_code: e.error ?? reason,
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
    expiresAt.value = null
    lastActivityAt.value = null
    // Amendment D/F: a fresh connect clears any prior already-linked countdown
    // and cap flag.
    alreadyLinkedUntil.value = null
    atCap.value = false
    // PR1 sliding-TTL status-bus state is per-session — a fresh connect must not
    // inherit a prior session's cap flag or extended-event throttle timestamp.
    lastHitCap = false
    lastExtendedFiredAt = 0
    resetThinking()
    teardownRelay()
    clearExpiryTimer()
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
      const startedForThisClick = connectStartedAt
      requestSession(relayOptions.boundContext)
        .then((mintResult) => {
          const { token: realToken } = mintResult
          // A disconnect, or a NEWER startConnect() click, may have already
          // moved on while this mint was in flight — don't resurrect a
          // channel over a session that's no longer the current one.
          if (connectStartedAt !== startedForThisClick || state.value === 'closed') return
          token.value = realToken
          // Track H: capture the token TTL (design contract's rail TTL meter /
          // toolbar chip countdown). Absent on the pre-relay/dev mint mocks, so
          // it stays null there and the meter/chip-countdown simply don't show.
          if (typeof mintResult.expiresInSec === 'number') {
            expiresAt.value = now() + mintResult.expiresInSec * 1000
            // #314: arm the TTL watchdog against the real deadline now that
            // it's known — see scheduleExpiry()'s own doc comment.
            scheduleExpiry()
          }
          // Hand the real token off to the (as-yet-idle) Fullscreen instance
          // — see sessionHandoff.ts. Only the real, relay-minted token is
          // persisted, never the local `pending-<ts>` placeholder: a
          // Fullscreen mount that reads nothing yet (this mint hasn't
          // resolved) falls back to today's blank-panel behavior, which is
          // strictly better than hydrating a token that will never resolve.
          if (boundContext) {
            persistSession({ ...boundContext, token: realToken, state: 'waiting', ...handoffFeedFields() })
          }
          openRelayChannel(realToken, relayOptions)
        })
        .catch((e) => {
          handleMintFailure(e, startedForThisClick)
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

  // Track G: called once at mount by the INLINE (non-Fullscreen) macro
  // instance ONLY — reattaches to a session THIS SAME macro (a prior
  // instance of it) already persisted, instead of resetting to 'idle'.
  //
  // Why this matters, not just UX polish:
  //   1. forgeIndex.ts's Fullscreen onClose calls `location.reload()` on the
  //      INLINE macro's own iframe UNCONDITIONALLY (not just for an explicit
  //      Disconnect) — the reload outlives relayClient.ts's in-process
  //      reconnect-by-token, so without this, every accidental Fullscreen
  //      close would strand the session at 'idle' even though the relay's DO
  //      correctly kept it 'suspended' and resumable.
  //   2. The per-contentId mint-exclusivity claim (design §7 decision #2)
  //      stays held by a live 'connected'/'suspended' session until it
  //      closes/expires — so calling startConnect() fresh here would 409
  //      diagram_already_linked against the very session this same user is
  //      trying to resume, actively making the reload case WORSE.
  // A no-op unless: a relay context exists, this instance is still 'idle'
  // (never re-entrant over a session already being driven), and a live
  // (< HANDOFF_TTL_MS old — sessionHandoff.ts) own-page record exists with
  // state 'connected' or 'suspended' (a 'waiting'-only record means an agent
  // never actually paired — nothing meaningful to resume, so a fresh
  // startConnect() mint is simpler and correct).
  function attemptReattach(): void {
    if (!boundContext || state.value !== 'idle') return
    const persisted = readSession(boundContext.pageId)
    if (!persisted) return
    // #314: a reload must never resurrect a dead token. The persisted record
    // may already say 'expired' (the owner's own watchdog fired before this
    // reload), or it may still say 'connected'/'suspended' with an expiresAt
    // that has silently lapsed while this instance was gone (e.g. the tab was
    // closed past the TTL) — either way, land directly on 'expired' instead
    // of reattaching a relay channel for a token the server has already
    // 403'd.
    if (
      persisted.state === 'expired' ||
      (typeof persisted.expiresAt === 'number' && persisted.expiresAt <= now())
    ) {
      token.value = persisted.token
      expiresAt.value = typeof persisted.expiresAt === 'number' ? persisted.expiresAt : null
      state.value = 'expired'
      return
    }
    if (persisted.state !== 'connected' && persisted.state !== 'suspended') return

    connectStartedAt = now()
    editsCount = 0
    lastAppliedDsl = typeof persisted.dsl === 'string' ? persisted.dsl : ''
    activityFeed.value = []
    // Same per-session reset as startConnect: a reattach on a fresh mount starts
    // the status-bus cap flag / extended-event throttle clean (spec §4.4).
    lastHitCap = false
    lastExtendedFiredAt = 0
    resetThinking()
    teardownRelay()
    token.value = persisted.token
    // Adopt 'connected' directly (not a fresh 'waiting' handshake) — the
    // persisted record is only ever 'connected'/'suspended' once an agent
    // has paired at least once. If the reattach itself fails, this fires a
    // REAL suspend for THIS instance via handleRelayStateEvent's 'close'
    // branch; no synthetic resumed/suspended pair is fabricated for a drop
    // this fresh instance never actually witnessed (that happened in the
    // now-destroyed pre-reload instance).
    state.value = 'connected'
    // final review 2026-07-13: live reattach must adopt the persisted
    // deadline before opening the relay. Otherwise the TTL meter/watchdog stay
    // dead until a later status envelope, even though the handoff record
    // already carried the authoritative deadline we guarded on above.
    if (typeof persisted.expiresAt === 'number') {
      expiresAt.value = persisted.expiresAt
      scheduleExpiry()
    }

    const relayOptions = options.relay
    if (relayOptions) openRelayChannel(persisted.token, relayOptions)
  }

  function onAgentConnected(): void {
    const prev = state.value
    state.value = nextClientState(state.value, 'agent_connected')
    if (prev === state.value) return // invalid from this state — no-op

    // Update the handoff record so a Fullscreen instance opened AFTER
    // pairing (e.g. closed then reopened) hydrates straight into
    // 'connected' instead of re-showing the (already-stale) waiting prompt.
    if (boundContext && token.value) {
      persistSession({ ...boundContext, token: token.value, state: 'connected', ...handoffFeedFields() })
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
    suspendedAt = null
    expiresAt.value = null
    lastActivityAt.value = null
    // Amendment D/F: a teardown clears any already-linked countdown and cap flag.
    alreadyLinkedUntil.value = null
    atCap.value = false
    // #314: an explicit disconnect (including out of 'expired' — see
    // agentLinkState.ts's `expired: { disconnect: 'closed' }`) makes any
    // still-pending TTL watchdog moot; clearing it here prevents a stale
    // timer from firing handleExpired() against a session that's already
    // being torn down for a different reason.
    clearExpiryTimer()
    // Explicit, user-driven disconnect: tell the relay's DO via a
    // {kind:'disconnect'} envelope (Track G) so it closes the session
    // outright instead of suspending it — suspension is reserved for an
    // ACCIDENTAL drop (see handleRelayStateEvent's 'close' branch and
    // relayClient.ts's close()/disconnect() split).
    relayClient?.disconnect()
    relayClient = null
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

  // "Revoke & re-link" (design decision #1's escape hatch for a dead first
  // agent, or for a session stuck 'suspended'): closes the current session
  // (same explicit-disconnect path as disconnect()) and immediately mints a
  // fresh token, in one action. Resets to 'idle' directly rather than relying
  // on a natural FSM transition out of the just-set terminal 'closed' —
  // startConnect() requires prev === 'idle' to actually mint/connect (see its
  // own guard), and this action IS a deliberate fresh start, not a
  // resurrection of the old (closed) session.
  function revokeAndRelink(): void {
    disconnect('user')
    state.value = 'idle'
    startConnect()
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
    } else if (
      state.value === 'connected' &&
      session.state === 'suspended' &&
      token.value === session.token
    ) {
      // Track G: the relay owner (inline macro instance, which actually owns
      // the live socket) saw its own ws_drop and republished 'suspended' —
      // mirror that onto this display-only (Fullscreen) instance's UI too
      // (the design contract requires "both surfaces show the state").
      state.value = nextClientState(state.value, 'ws_drop')
    } else if (
      state.value === 'suspended' &&
      session.state === 'connected' &&
      token.value === session.token
    ) {
      // Mirror the relay owner's own resume (see handleRelayStateEvent's
      // 'open' branch) onto this display-only instance.
      state.value = nextClientState(state.value, 'resumed')
    } else if (
      state.value === 'suspended' &&
      session.state === 'recovery_exhausted' &&
      token.value === session.token
    ) {
      state.value = nextClientState(state.value, 'reconnect_failed')
    } else if (
      (state.value === 'waiting' || state.value === 'timeout') &&
      session.state === 'incompatible' &&
      token.value === session.token
    ) {
      state.value = nextClientState(state.value, 'protocol_incompatible')
    } else if (
      (state.value === 'connected' ||
        state.value === 'suspended' ||
        state.value === 'waiting' ||
        state.value === 'timeout') &&
      session.state === 'expired' &&
      token.value === session.token
    ) {
      // #314: the relay owner's own TTL watchdog (handleExpired()) fired and
      // republished 'expired' — mirror that onto this display-only
      // (Fullscreen) instance too, so it stops showing a live variant with
      // the countdown pinned at "0:00" just because it never received the
      // event itself. (The idle branch above already covers a Fullscreen
      // that hydrates an already-expired record fresh from 'idle'.)
      state.value = nextClientState(state.value, 'expired')
    }

    // --- token TTL (Track H cross-iframe mirror, bug 2 fix) ---------------
    // Mirrors the owner's expiresAt onto this display-only instance so its
    // own TTL meter / chip countdown (ConnectPanel.vue / SessionTtl.vue) has
    // something to render — previously always null here, so those surfaces
    // never lit up in the real cross-iframe topology (spot-check #3).
    // Unconditional (not gated to the idle branch above): a stable per-token
    // value, and the reactive handoff watcher may deliver this record more
    // than once for the same session.
    if (typeof session.expiresAt === 'number') {
      expiresAt.value = session.expiresAt
      // #314: this (display-only) instance also arms its OWN TTL watchdog
      // off the mirrored deadline — defense in depth so a Fullscreen surface
      // still notices the lapse on its own clock even if it never receives
      // the owner's 'expired' mirror (e.g. the owner's iframe/timers were
      // torn down before its own watchdog fired). Idempotent: re-hydrating
      // the same expiresAt just re-arms an equivalent timer.
      scheduleExpiry()
    }
    if (typeof session.lastActivityAt === 'number') {
      lastActivityAt.value = session.lastActivityAt
    }

    // --- Amendment D: honest already-linked countdown mirror -------------
    // The relay owner (inline) learns the lock release time from the mint
    // 409 and persists it on the already_linked record; mirror it here so the
    // Fullscreen SessionNotice shows the same honest countdown.
    if (session.state === 'already_linked' && typeof session.lockExpiresAt === 'number') {
      alreadyLinkedUntil.value = session.lockExpiresAt
    }

    // --- Amendment F: sliding-TTL cap flag mirror ------------------------
    // The relay owner (inline) learns hitCap from the DO status envelope and
    // persists it on the handoff record; mirror it so SessionTtl on this
    // display-only surface suppresses the "extends while your agent works"
    // hint once the deadline is cap-bound.
    if (typeof session.hitCap === 'boolean') {
      atCap.value = session.hitCap
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

    // --- activity feed (Track U discovery + Track F/G, bug 2 fix) --------
    // The handoff record's `feed` is the owner's own authoritative bounded
    // snapshot (search/list/read/edit/suspend/resume rows) — adopt it
    // directly rather than relying only on the ad hoc per-branch appends
    // above, so this display-only instance's rail shows the SAME history the
    // owner sees. This is what makes discovery rows (search_diagrams/
    // list_diagrams/read_diagram) visible here at all: those ops never touch
    // `state`/`dsl`/`thinking`, so without this the Fullscreen rail's feed
    // stayed empty no matter how many the agent ran (spot-check #3). Always
    // an array once present (even `[]` right after the owner's own reset),
    // so a plain truthy check is enough; falls back to the local
    // reconstruction above for a pre-bug-2 record that never carried `feed`.
    if (session.feed) {
      activityFeed.value = session.feed
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
    expiresAt,
    alreadyLinkedUntil,
    atCap,
    lastActivityAt,
    thinkingState,
    activityFeed,
    startConnect,
    attemptReattach,
    onAgentConnected,
    applyEdit,
    disconnect,
    revokeAndRelink,
    notifyRenderSettled,
    hydrateFrom,
    watchForHandoff,
    watchForAnyHandoff,
  }
}
