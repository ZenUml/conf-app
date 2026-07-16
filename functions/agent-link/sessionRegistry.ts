// In-memory session store for the Live Agent Link relay.
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.2.
//
// TODO(agent-link): host in AgentLinkSession DO. A plain in-memory Map only
// lives for the lifetime of one Worker isolate, so it's fine for local dev /
// unit tests but cannot pair a macro connection with an agent connection that
// lands on a different isolate in production. The Durable Object
// (`functions/agent-link/AgentLinkSession.ts`) is where this store's logic
// ultimately needs to run, keyed by token, so every request for a given
// session is routed to the same DO instance.

import { isExpired, mintToken, nextState } from './sessionToken';
import type { BoundContext, SessionRecord } from './sessionToken';

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();

  /** Mints a token and creates a new 'created' session bound to `ctx`. */
  create(ctx: BoundContext): SessionRecord {
    const nowMs = Date.now();
    const record: SessionRecord = {
      token: mintToken(),
      boundContext: ctx,
      scope: 'read-page+write-diagram',
      issuedAtMs: nowMs,
      lastActivityMs: nowMs,
      state: 'created',
    };
    this.sessions.set(record.token, record);
    return record;
  }

  get(token: string): SessionRecord | undefined {
    return this.sessions.get(token);
  }

  /**
   * Drives the 'agent_paired' transition for `token`. Returns false (no-op)
   * when the token is unknown or already past 'created' — pairing is only
   * valid once, from 'created' to 'paired'.
   */
  pair(token: string): boolean {
    const record = this.sessions.get(token);
    if (!record) return false;
    const next = nextState(record.state, 'agent_paired');
    if (next === record.state) return false;
    record.state = next;
    return true;
  }

  /** Removes every session whose token has passed its TTL. Returns the count removed. */
  expireStale(nowMs: number): number {
    let removed = 0;
    for (const [token, record] of this.sessions) {
      if (isExpired(record.issuedAtMs, record.lastActivityMs, nowMs)) {
        this.sessions.delete(token);
        removed++;
      }
    }
    return removed;
  }
}
