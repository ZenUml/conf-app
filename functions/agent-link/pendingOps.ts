// Id-correlation for the HTTP agent-op bridge (`POST /agent-op` on
// AgentLinkSession, the Durable Object — see AgentLinkSession.ts).
//
// AgentLinkSession is a Durable Object: it can't be constructed in vitest
// without a real Workers runtime (no `DurableObjectState`/`WebSocketPair`
// globals under the repo's jsdom test environment — see
// AgentLinkSession.ts's file header). This class holds none of that; it is
// plain JS (a Map + setTimeout), so the id-correlation + timeout logic that
// `POST /agent-op` depends on is unit-testable on its own (pendingOps.spec.ts),
// mirroring how forwarding.ts / sessionToken.ts split pure logic out of the
// DO for testability.
//
// Contract: `register(id, timeoutMs)` returns a Promise that settles exactly
// once, either when a matching `resolve(id, result)` call arrives (from the
// macro's `result`/`error` envelope, per AgentLinkSession.webSocketMessage)
// or after `timeoutMs` elapses — never rejects; the caller (AgentLinkSession)
// maps `{ timedOut: true }` to an HTTP 504.

export interface PendingOpResult {
  ok: boolean;
  payload: unknown;
}

export type PendingOpOutcome = PendingOpResult | { timedOut: true };

export class PendingOps {
  private readonly resolvers = new Map<string, (outcome: PendingOpOutcome) => void>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Registers `id` as awaiting a reply and returns the promise that settles
   * on `resolve(id, ...)` or after `timeoutMs`. Overwrites (without settling)
   * any prior in-flight registration for the same `id` — callers are
   * expected to use unique ids per op (AgentLinkSession mints one per HTTP
   * `/agent-op` call), so this should not occur in practice.
   */
  register(id: string, timeoutMs: number): Promise<PendingOpOutcome> {
    return new Promise((resolve) => {
      this.resolvers.set(id, resolve);
      const timer = setTimeout(() => {
        if (this.resolvers.delete(id)) {
          this.timers.delete(id);
          resolve({ timedOut: true });
        }
      }, timeoutMs);
      this.timers.set(id, timer);
    });
  }

  /**
   * Resolves the pending op for `id` with `result`, if one is still waiting.
   * Returns `true` if a matching pending op was found (and thus settled),
   * `false` if `id` is unknown (already resolved, already timed out, or was
   * never registered) — the caller uses this to decide whether a macro
   * `result`/`error` envelope had anyone still listening.
   */
  resolve(id: string, result: PendingOpResult): boolean {
    const resolveFn = this.resolvers.get(id);
    if (!resolveFn) return false;

    this.resolvers.delete(id);
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    resolveFn(result);
    return true;
  }

  /**
   * Cancels a pending registration without settling its promise — used when
   * the send to the macro socket itself throws synchronously (e.g. socket
   * already closing), so the caller can return its own error response
   * instead of waiting for the timeout to fire on a request that never went
   * anywhere.
   */
  cancel(id: string): void {
    this.resolvers.delete(id);
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  /** Count of ops currently awaiting a reply — for tests/diagnostics only. */
  get size(): number {
    return this.resolvers.size;
  }
}
