// src/composables/agentLink/agentLinkState.ts
//
// Pure client state machine for the Live Agent Link macro side
// (docs/superpowers/specs/2026-07-08-live-agent-link-design.md §7).
// Mirrors the relay's session state machine from the macro's point of view:
// `created`→(macro waiting) `waiting` → `connected`; `waiting` → `timeout`
// after ~SETUP_TIMEOUT_MS with no pairing (UI-only — the session may still
// pair later, timeout just reveals the connector setup instructions).
//
// No side effects, no imports — kept trivially unit-testable and reusable
// from both the Vue composable (useAgentLinkSession.ts) and its tests.

export type AgentLinkClientState =
  | "idle"
  | "waiting"
  | "connected"
  | "timeout"
  | "suspended"
  | "recovery_exhausted"
  | "incompatible"
  | "closed"
  | "already_linked"
  | "failed"
  // #314: the relay-minted token's idle window (10 min) lapsed on the
  // client's own clock — see useAgentLinkSession.ts's scheduleExpiry()/
  // handleExpired(). Reachable from any state that has a live-or-pending
  // token (waiting/timeout/connected/suspended); idle/closed/already_linked/
  // failed never carry a token, so there's nothing for them to expire.
  | "expired";

export type AgentLinkClientEvent =
  | "connect_clicked"
  | "session_created"
  | "agent_connected"
  | "timeout"
  | "disconnect"
  | "mint_rejected"
  | "mint_failed"
  // Mirrors the relay's server-side FSM (functions/agent-link/sessionToken.ts,
  // Track G / G-design.md): the relay socket closed unexpectedly (not an
  // explicit Disconnect) — 'ws_drop' fires only from 'connected' (the macro
  // had a live pairing to lose); 'resumed' fires once a same-token reconnect
  // succeeds (relayClient.ts already reconnects-by-token; this is the
  // client-side UI counterpart to the server's 'reattach').
  | "ws_drop"
  | "resumed"
  | "reconnect_failed"
  | "protocol_incompatible"
  // #314: fired by useAgentLinkSession.ts's client-side TTL watchdog the
  // instant `expiresAt` lapses — the relay independently 403s the agent
  // server-side ("Session token expired"), but nothing previously told this
  // FSM to leave whatever live/pending state it was in, so the rail stayed
  // stuck showing a "connected" variant forever.
  | "expired";

// The ~20s "no agent yet → show setup" delay (design §3 decision #6:
// "presence + timeout"). Exported so callers (useAgentLinkSession) and tests
// share one source of truth instead of hardcoding the duration twice.
export const SETUP_TIMEOUT_MS = 20000;

// Perceived-latency "AI is thinking" surface state (charter §6, Track F). This
// is DELIBERATELY orthogonal to AgentLinkClientState above — a paired session
// is `connected` the whole time an agent op is in flight; whether the render
// surface should be showing a shimmer is a SEPARATE axis. Keeping it out of
// the connection state machine means the flag-off / no-session path is
// unchanged (thinkingState never leaves 'idle') and a render op can begin/end
// without perturbing idle/waiting/connected/timeout/closed.
//   'idle'     — no op in flight; render surface shows the diagram as-is.
//   'thinking' — an `update_diagram` op is in flight; show the shimmer overlay.
//   'error'    — the last op failed / timed out; show a brief error cue, then
//                auto-return to 'idle' (never a stuck shimmer).
export type AgentLinkThinkingState = "idle" | "thinking" | "error";

// Backstop that guarantees the thinking shimmer can NEVER get stuck on
// (charter §6 hard constraint: "a dropped WS must not leave an eternal
// shimmer"). If no terminal render/failure signal arrives within this window
// after an op begins, the thinking state auto-clears to 'error' and
// agent_link_render_completed fires with render_outcome:'timeout'.
//
// EVIDENCE-BASED, not a round number (2026-07-09, read-only query of the
// diagramly.ai Neon `Job` table — the closest real corpus of user↔AI-agent
// diagram-modification interactions, n=285, all COMPLETED). Observed
// agent-side processing duration (startedAt→completedAt) for
// type='diagram_modification':
//     p50 5.2s · p90 12.7s · p95 16.2s · p99 40.5s · max 463s (single outlier)
//   retryCount = 0 across all 285 rows (first-try success; no retry storms).
// 60s ≈ 1.5× the p99 (40.5s): comfortably above a legitimately slow op, while
// deliberately cutting the pathological 463s tail — a 7.7-minute shimmer is
// worse UX than surfacing a timeout error at 60s and letting the user re-ask.
// CAVEAT: those numbers time the agent's whole LLM+tool generation. conf-app's
// shimmer only runs from op-RECEIVED-at-the-macro → persist(saveCustomContentV2)
// → render — the DSL arrives already generated, so the real macro-side window
// is the short tail of that distribution (typically <2s). 60s is therefore a
// generous backstop for the anomaly cases (dropped WS, hung persist), not a
// value the happy path ever approaches.
export const RENDER_SAFETY_TIMEOUT_MS = 60000;

// Explicit transition table. States/events not listed here are no-ops — the
// current state is returned unchanged (covers invalid events and the
// `closed` terminal state absorbing everything).
const TRANSITIONS: Partial<
  Record<AgentLinkClientState, Partial<Record<AgentLinkClientEvent, AgentLinkClientState>>>
> = {
  idle: {
    connect_clicked: "waiting",
  },
  waiting: {
    session_created: "waiting",
    agent_connected: "connected",
    timeout: "timeout",
    disconnect: "closed",
    mint_rejected: "already_linked",
    mint_failed: "failed",
    expired: "expired",
    protocol_incompatible: "incompatible",
  },
  timeout: {
    agent_connected: "connected",
    disconnect: "closed",
    mint_rejected: "already_linked",
    mint_failed: "failed",
    expired: "expired",
    protocol_incompatible: "incompatible",
  },
  connected: {
    disconnect: "closed",
    ws_drop: "suspended",
    expired: "expired",
  },
  suspended: {
    resumed: "connected",
    reconnect_failed: "recovery_exhausted",
    disconnect: "closed",
    expired: "expired",
  },
  recovery_exhausted: {
    disconnect: "closed",
    expired: "expired",
  },
  incompatible: {
    disconnect: "closed",
  },
  closed: {},
  // #314: the only event 'expired' itself responds to is an explicit
  // disconnect (e.g. the rail's Reconnect/"Revoke & re-link" CTA closing this
  // dead session before minting a fresh one) — everything else is a no-op via
  // the default fallback.
  expired: {
    disconnect: "closed",
  },
};

export function nextClientState(
  current: AgentLinkClientState,
  event: AgentLinkClientEvent
): AgentLinkClientState {
  return TRANSITIONS[current]?.[event] ?? current;
}
