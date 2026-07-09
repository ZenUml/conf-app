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
  | "closed";

export type AgentLinkClientEvent =
  | "connect_clicked"
  | "session_created"
  | "agent_connected"
  | "timeout"
  | "disconnect";

// The ~20s "no agent yet → show setup" delay (design §3 decision #6:
// "presence + timeout"). Exported so callers (useAgentLinkSession) and tests
// share one source of truth instead of hardcoding the duration twice.
export const SETUP_TIMEOUT_MS = 20000;

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
  },
  timeout: {
    agent_connected: "connected",
    disconnect: "closed",
  },
  connected: {
    disconnect: "closed",
  },
  closed: {},
};

export function nextClientState(
  current: AgentLinkClientState,
  event: AgentLinkClientEvent
): AgentLinkClientState {
  return TRANSITIONS[current]?.[event] ?? current;
}
