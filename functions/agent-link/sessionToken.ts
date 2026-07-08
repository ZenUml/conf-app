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

/** Relay session state machine states (design §7). */
export type SessionState = 'created' | 'paired' | 'active' | 'closed' | 'expired';

/** Events that can drive a state transition (design §7). */
export type SessionEvent = 'macro_connected' | 'agent_paired' | 'edit' | 'disconnect' | 'expire';

export interface SessionRecord {
  token: string;
  boundContext: BoundContext;
  /** MVP scope is fixed — decision #4, no page-body authoring, no other-macro writes. */
  scope: 'read-page+write-diagram';
  issuedAtMs: number;
  state: SessionState;
}

/** Token lifetime — design §8: "Short-lived (≤10 min), single-use". */
export const TOKEN_TTL_MS = 10 * 60 * 1000;

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

/** Mints an opaque, URL-safe, human-pasteable session token, e.g. "CL-7F3K-Q9M2". */
export function mintToken(): string {
  return `CL-${randomSegment(4)}-${randomSegment(4)}`;
}

/** True once `nowMs` is at or past `issuedAtMs + TOKEN_TTL_MS`. */
export function isExpired(issuedAtMs: number, nowMs: number): boolean {
  return nowMs - issuedAtMs >= TOKEN_TTL_MS;
}

/**
 * Pure state transition (design §7):
 *   created --macro_connected--> created   (still waiting for the agent)
 *   created --agent_paired-----> paired
 *   paired  --edit-------------> active
 *   active  --edit-------------> active
 *   created/paired --expire----> expired
 *   (any non-terminal state) --disconnect--> closed
 *   closed / expired are absorbing: every event leaves them unchanged.
 *   Any other (state, event) pair is invalid and returns `cur` unchanged.
 */
export function nextState(cur: SessionState, event: SessionEvent): SessionState {
  // Terminal states absorb every event, including 'disconnect'.
  if (cur === 'closed' || cur === 'expired') return cur;

  if (event === 'disconnect') return 'closed';

  switch (cur) {
    case 'created':
      if (event === 'macro_connected') return 'created';
      if (event === 'agent_paired') return 'paired';
      if (event === 'expire') return 'expired';
      return cur; // 'edit' is invalid before pairing
    case 'paired':
      if (event === 'edit') return 'active';
      if (event === 'expire') return 'expired';
      return cur; // macro_connected/agent_paired again are invalid no-ops
    case 'active':
      if (event === 'edit') return 'active';
      return cur; // macro_connected/agent_paired/expire are invalid once active
    default:
      return cur;
  }
}
