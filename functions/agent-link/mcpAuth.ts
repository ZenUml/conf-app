// Session-token authentication for the hosted MCP endpoint.
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §8
// ("Token = auth.") and §6 (MCP tool surface, bound to one session).
//
// Pure function over a SessionRegistry — no request/Response handling here
// (that's mcp.ts), so this is unit-testable in isolation.

import { isExpired } from './sessionToken';
import type { SessionRecord } from './sessionToken';
import type { SessionRegistry } from './sessionRegistry';

export type AuthFailureCode = 'missing' | 'invalid' | 'expired';

export type AuthResult = { ok: true; session: SessionRecord } | { ok: false; code: AuthFailureCode };

/**
 * Authenticates a bearer/query session token against `registry`:
 *   - blank/missing token           -> { ok: false, code: 'missing' }
 *   - not a known session token     -> { ok: false, code: 'invalid' }
 *   - known but past its TTL        -> { ok: false, code: 'expired' }
 *   - known and still fresh         -> { ok: true, session }
 */
export function authenticateSession(
  token: string | null | undefined,
  registry: SessionRegistry,
  nowMs: number,
): AuthResult {
  if (!token || token.trim().length === 0) {
    return { ok: false, code: 'missing' };
  }

  const session = registry.get(token);
  if (!session) {
    return { ok: false, code: 'invalid' };
  }

  if (isExpired(session.issuedAtMs, session.lastActivityMs, nowMs)) {
    return { ok: false, code: 'expired' };
  }

  return { ok: true, session };
}
