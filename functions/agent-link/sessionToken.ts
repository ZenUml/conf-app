// Pure helpers for the Live Agent Link relay session core.
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.2 (relay
// components), §7 (session state machine), §8 (token = auth).
//
// No I/O in this file — everything here is a pure function so it can be unit
// tested without a Workers runtime, a Durable Object, or a network call.

/** The Confluence entity a session is bound to (decision #4: read-page + write-this-diagram only). */
export interface BoundContext {
  cloudId: string;
  pageId: string;
  contentId: string;
}

/** Relay session state machine states (design §7, extended by the G-design.md
 * session-lifecycle spec with `suspended`). */
export type SessionState = 'created' | 'paired' | 'active' | 'suspended' | 'closed' | 'expired';

/**
 * Events that can drive a state transition (design §7, extended by
 * G-design.md):
 *   - 'ws_drop'   — a peer's socket closed/errored WITHOUT a preceding
 *                    explicit disconnect envelope (accidental: Fullscreen
 *                    close, tab crash, net blip). Suspends rather than closes.
 *   - 'reattach'   — the macro reopens/reloads and reconnects with the SAME
 *                    token while the session is 'suspended', within the
 *                    resume window (remaining token TTL).
 */
export type SessionEvent =
  | 'macro_connected'
  | 'agent_paired'
  | 'edit'
  | 'disconnect'
  | 'expire'
  | 'ws_drop'
  | 'reattach';

export interface SessionRecord {
  token: string;
  boundContext: BoundContext;
  /** MVP scope is fixed — decision #4, no page-body authoring, no other-macro writes. */
  scope: 'read-page+write-diagram';
  issuedAtMs: number;
  /** Last bump-worthy agent activity (spec 2026-07-13 §3); starts = issuedAtMs. */
  lastActivityMs: number;
  state: SessionState;
}

/** Sliding-TTL policy (spec 2026-07-13 §3, user-decided): each bump-worthy
 * agent request resets a 10-min idle window; no session outlives 60 min. */
export const IDLE_TTL_MS = 10 * 60 * 1000;
export const MAX_SESSION_MS = 60 * 60 * 1000;

// Crockford base32 alphabet: excludes I, L, O, U to avoid visual ambiguity
// when a user reads the token off screen and types/pastes it.
const TOKEN_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomSegment(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return out;
}

/** Mints an opaque, URL-safe, human-pasteable session token, e.g. "CL-8F3K7Q". */
export function mintToken(): string {
  return `CL-${randomSegment(6)}`;
}

/** The server-authoritative deadline: min(idle window, absolute cap). */
export function effectiveExpiryMs(issuedAtMs: number, lastActivityMs: number): number {
  return Math.min(lastActivityMs + IDLE_TTL_MS, issuedAtMs + MAX_SESSION_MS);
}

/** True once the deadline is bounded by the cap, not the idle window —
 * carried on status envelopes so the client can report expiry_cause. */
export function isAtCap(issuedAtMs: number, lastActivityMs: number): boolean {
  return lastActivityMs + IDLE_TTL_MS >= issuedAtMs + MAX_SESSION_MS;
}

/** True once `nowMs` is at or past the effective (slid, capped) deadline. */
export function isExpired(issuedAtMs: number, lastActivityMs: number, nowMs: number): boolean {
  return nowMs >= effectiveExpiryMs(issuedAtMs, lastActivityMs);
}

/**
 * Pure state transition (design §7, extended by G-design.md's session
 * lifecycle spec):
 *   created --macro_connected--> created   (still waiting for the agent)
 *   created --agent_paired-----> paired
 *   paired  --edit-------------> active
 *   active  --edit-------------> active
 *   created/paired --expire----> expired
 *   (any live state, incl. suspended) --disconnect--> closed
 *   (any live pre-suspended state) --ws_drop--> suspended
 *   suspended --reattach-------> active
 *   suspended --expire----------> expired   (ttl_expiry: resume window =
 *                                            remaining token TTL, no extension)
 *   closed / expired are absorbing: every event leaves them unchanged.
 *   Any other (state, event) pair is invalid and returns `cur` unchanged.
 *
 * NOTE on `ws_drop`'s scope: the design doc's FSM diagram labels this
 * transition "active --ws_drop--> suspended", but it is implemented here to
 * fire from EVERY live pre-suspended state (created/paired/active), not only
 * 'active'. Reason: an HTTP-only agent (mcp.ts's transport) never drives
 * 'agent_paired'/'edit' over this session's WebSocket, so a real session
 * normally sits at 'created' indefinitely (see AgentLinkSession.ts's file
 * header) — restricting ws_drop to 'active' would mean the Fullscreen
 * close/reopen suspend-and-resume flow this task exists for never actually
 * fires in production. Generalizing is a deliberate, documented deviation.
 */
export function nextState(cur: SessionState, event: SessionEvent): SessionState {
  // Terminal states absorb every event, including 'disconnect'.
  if (cur === 'closed' || cur === 'expired') return cur;

  // Explicit disconnect (macro-side Disconnect button, or an explicit
  // agent-side close) is the ONLY path to 'closed' — from any live state,
  // including 'suspended'.
  if (event === 'disconnect') return 'closed';

  // Accidental disconnect (Fullscreen close, inline reload, tab crash, net
  // blip) suspends rather than closes outright — see the NOTE above for why
  // this isn't restricted to 'active'.
  if (event === 'ws_drop') return cur === 'suspended' ? cur : 'suspended';

  if (cur === 'suspended') {
    if (event === 'reattach') return 'active';
    if (event === 'expire') return 'expired';
    return cur; // macro_connected/agent_paired/edit while suspended are no-ops (ops are rejected, not queued)
  }

  switch (cur) {
    case 'created':
      if (event === 'macro_connected') return 'created';
      if (event === 'agent_paired') return 'paired';
      if (event === 'expire') return 'expired';
      return cur; // 'edit'/'reattach' are invalid before pairing/suspension
    case 'paired':
      if (event === 'edit') return 'active';
      if (event === 'expire') return 'expired';
      return cur; // macro_connected/agent_paired/reattach again are invalid no-ops
    case 'active':
      if (event === 'edit') return 'active';
      return cur; // macro_connected/agent_paired/expire/reattach are invalid once active
    default:
      return cur;
  }
}
