// Pure message-forwarding logic for the Live Agent Link relay.
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §4.4 (edit
// round-trip & read), §5.2 (AgentLinkSession forwards messages between the
// macro conn and the agent conn), §7 (session state machine).
//
// No sockets in this file — it only decides *what to do* with a raw string
// message: parse it, decide where it routes, decide the next session state.
// AgentLinkSession.ts is the only place that touches an actual WebSocket; it
// calls into these pure functions for every decision, so the decision logic
// is unit-testable without a Workers runtime (see forwarding.spec.ts).
//
// Reuses (does not redefine) SessionState / SessionEvent / nextState from
// sessionToken.ts, per this task's scope.

import { nextState } from './sessionToken';
import type { SessionEvent, SessionState } from './sessionToken';

/** Which side of a paired session a message came from / is routed to. */
export type Peer = 'macro' | 'agent';

/**
 * The message kinds agent<->macro exchange over the relay channel (design
 * §4.4, §6):
 *   - 'op'     — agent -> macro tool request, e.g. read_page / read_diagram /
 *                update_diagram / get_status. Carries `op` + `payload`.
 *   - 'result' — macro -> agent successful reply to an 'op', keyed by `id`.
 *   - 'error'  — macro -> agent failed reply to an 'op', keyed by `id`.
 *   - 'ping'   — either side; a keepalive handled locally by the DO, never
 *                forwarded to the other peer.
 *   - 'disconnect' — either side; an EXPLICIT disconnect signal (the macro's
 *                Disconnect button, or an explicit agent-side close) — design
 *                §7's ONLY path to the terminal 'closed' state, as opposed to
 *                an unexpected socket close/error (which suspends instead).
 *                Handled directly by AgentLinkSession.webSocketMessage
 *                (closeSession) rather than forwarded verbatim.
 *   - 'invalid' — internal-only: the raw string was not a well-formed
 *                envelope (bad JSON, non-object, or an unrecognized/missing
 *                `kind`). Never sent on the wire; only ever produced by
 *                `parseEnvelope` for the caller to detect and drop.
 */
export type EnvelopeKind = 'op' | 'result' | 'error' | 'ping' | 'disconnect' | 'invalid';

export interface Envelope {
  kind: EnvelopeKind;
  id?: string;
  op?: string;
  payload?: unknown;
  /** Present only when kind === 'invalid': why parsing/validation failed. */
  reason?: string;
}

/**
 * Parses the raw JSON string message either side sends over its WS channel.
 * Recognized shapes:
 *   agent -> macro: {"kind":"op","id":"...","op":"read_page"|"read_diagram"|"update_diagram"|"get_status","payload":{...}}
 *   macro -> agent: {"kind":"result","id":"...","payload":{...}} | {"kind":"error","id":"...","payload":{...}}
 *   either side:    {"kind":"ping"}
 * Anything that isn't valid JSON, isn't a plain object, or has a
 * missing/unrecognized `kind` comes back as `{kind:'invalid', reason}` rather
 * than throwing — the caller (AgentLinkSession) decides what to do with a
 * malformed message (drop it, tell the sender).
 */
export function parseEnvelope(raw: string): Envelope {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'not valid JSON' };
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { kind: 'invalid', reason: 'envelope must be a JSON object' };
  }

  const obj = data as Record<string, unknown>;
  const kind = obj.kind;
  if (kind !== 'op' && kind !== 'result' && kind !== 'error' && kind !== 'ping' && kind !== 'disconnect') {
    return { kind: 'invalid', reason: `unknown or missing "kind": ${JSON.stringify(obj.kind)}` };
  }

  const envelope: Envelope = { kind };
  if (typeof obj.id === 'string') envelope.id = obj.id;
  if (typeof obj.op === 'string') envelope.op = obj.op;
  if ('payload' in obj) envelope.payload = obj.payload;

  return envelope;
}

/** Outcome of `routeMessage`: forward verbatim to the other peer, or drop it locally. */
export type RouteDecision = { to: Peer } | { drop: string };

/**
 * Decides where a parsed envelope routes (design §4.4, §5.2 "forwards
 * messages"):
 *   - agent sends 'op'             -> forward to the macro
 *   - macro sends 'result'/'error' -> forward to the agent
 *   - 'ping' (either side)         -> handled locally, never forwarded, `{drop:'ping'}`
 *   - 'disconnect' (either side)  -> handled locally by AgentLinkSession
 *     (closeSession), never forwarded verbatim, `{drop:'disconnect'}`
 *   - anything else (wrong-direction kind, e.g. macro sending 'op', or an
 *     'invalid' envelope) -> `{drop:'unknown'}`
 */
export function routeMessage(from: Peer, envelope: Envelope): RouteDecision {
  if (envelope.kind === 'ping') return { drop: 'ping' };
  if (envelope.kind === 'disconnect') return { drop: 'disconnect' };
  if (from === 'agent' && envelope.kind === 'op') return { to: 'macro' };
  if (from === 'macro' && (envelope.kind === 'result' || envelope.kind === 'error')) return { to: 'agent' };
  return { drop: 'unknown' };
}

/**
 * Applies a routed envelope to the session state machine (design §7): an
 * agent 'op' while the session is 'paired' or 'active' drives the 'edit'
 * event (paired -> active, active -> active), matching the design's "edits
 * flowing" definition of the 'active' state. Every other (state, envelope,
 * from) combination is a no-op and returns `state` unchanged — in
 * particular, disconnects are NOT driven from here; the DO's own
 * close/error handlers call `nextState(state, 'disconnect')` directly (see
 * AgentLinkSession.ts), since a socket closing isn't a *message* this module
 * ever sees.
 */
export function applyEvent(state: SessionState, envelope: Envelope, from: Peer): SessionState {
  if (from === 'agent' && envelope.kind === 'op' && (state === 'paired' || state === 'active')) {
    return nextState(state, 'edit');
  }
  return state;
}

/**
 * Which FSM event a peer's WS-upgrade connect should drive (G-design.md's
 * session lifecycle spec). Extracted as a pure helper — separate from
 * AgentLinkSession.fetch()'s WebSocketPair/acceptWebSocket plumbing, which
 * needs a real Workers runtime to exercise — so this specific decision is
 * unit-testable without one (see forwarding.spec.ts):
 *   - the session was 'suspended' (a prior macro socket dropped, this is a
 *     same-token reattach within the resume window) -> 'reattach', regardless
 *     of which peer reconnects;
 *   - otherwise, a peer's FIRST connect for this token -> the original
 *     'macro_connected'/'agent_paired' bootstrap event (design §7).
 */
export function reattachEvent(peer: Peer, wasSuspended: boolean): SessionEvent {
  if (wasSuspended) return 'reattach';
  return peer === 'macro' ? 'macro_connected' : 'agent_paired';
}

/** Activity descriptor carried on a relay-originated status envelope
 * (spec 2026-07-13 §4): 'agent_request' = a bump-worthy MCP request;
 * 'guardrail_rejected' = mcp.ts's update_diagram guard refused a write the
 * macro never saw; 'protocol_incompatible' = the MCP initialize handshake
 * rejected the client revision before any tool could run;
 * 'client_identified' = a compatible initialize handshake reduced to a safe
 * display label; 'turn' = a host-side hook bracket (PR3, reserved). */
export interface StatusActivity {
  type: 'agent_request' | 'guardrail_rejected' | 'protocol_incompatible' | 'client_identified' | 'turn';
  detail?: string;
}

/** Builds the ONE relay-originated envelope kind (macro-bound, never routed
 * between peers — parseEnvelope deliberately keeps rejecting a peer-sent
 * 'status'). Everything the macro passively learns rides this: the fresh
 * authoritative deadline, whether the 60-min cap now bounds it, and any
 * non-forwarded activity worth showing. */
export function statusEnvelope(expiresAt: number, hitCap: boolean, activity?: StatusActivity): string {
  return JSON.stringify({ kind: 'status', expiresAt, hitCap, ...(activity ? { activity } : {}) });
}
