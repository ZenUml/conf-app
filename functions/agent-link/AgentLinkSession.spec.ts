import { describe, it, expect, vi } from 'vitest';
import { AgentLinkSession, AGENT_OP_TIMEOUT_MS } from './AgentLinkSession';
import type { BoundContext, SessionRecord, SessionState } from './sessionToken';

// AgentLinkSession is a Durable Object: its WebSocket-upgrade path
// (`WebSocketPair`, `state.acceptWebSocket`, hibernation callbacks actually
// firing) needs a real Workers runtime and isn't exercised here — see the
// class's own file header, and forwarding.spec.ts / sessionToken.spec.ts for
// the pure logic that path delegates to.
//
// The `/session` and `/agent-op` HTTP routes added for the agent-side
// transport (mcp.ts) only touch `this.session` / `this.macroSocket` (plain
// fields) plus a fake `DurableObjectState.getTags`, so — unlike the WS
// pairing flow — they CAN be driven directly against a real
// `AgentLinkSession` instance in vitest. Private fields are set via `as any`
// the same way the class's own `fetch`/`webSocketMessage` would populate
// them at runtime (a macro's first `GET /channel` bootstraps `this.session`;
// its WS upgrade sets `this.macroSocket`); reaching into them here avoids
// needing `WebSocketPair` just to get a session bootstrapped for these
// HTTP-only tests.

const CTX: BoundContext = { cloudId: 'cloud-1', pageId: 'page-1', contentId: 'content-1' };

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    token: 'CL-TEST-TOKN',
    boundContext: CTX,
    scope: 'read-page+write-diagram',
    issuedAtMs: Date.now(),
    state: 'created' as SessionState,
    ...overrides,
  };
}

function makeState(store: Map<string, unknown> = new Map()) {
  return {
    storage: {
      setAlarm: vi.fn(async () => {}),
      deleteAlarm: vi.fn(async () => {}),
      // Backed by a real Map so the ISSUE-3 persist/restore path
      // (put on bootstrap, get on a hibernation wake, delete on teardown)
      // round-trips in tests.
      get: vi.fn(async (key: string) => store.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    },
    getTags: vi.fn((_ws: unknown) => [] as string[]),
    // Returns the hibernatable sockets for a peer tag; default none. Tests
    // that exercise a wake override this to hand back the surviving socket.
    getWebSockets: vi.fn((_tag?: string) => [] as unknown[]),
    acceptWebSocket: vi.fn(),
  } as unknown as DurableObjectState;
}

function makeFakeMacroWs() {
  return { send: vi.fn() };
}

function agentOpRequest(body: unknown): Request {
  return new Request('https://agent-link-do/agent-op', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function sessionInfoRequest(): Request {
  return new Request('https://agent-link-do/session', { method: 'GET' });
}

/** Flushes the microtask queue (a real setTimeout(0) only fires once every pending microtask has run). */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AgentLinkSession — agent-side HTTP transport (GET /session, POST /agent-op)', () => {
  describe('GET /session', () => {
    it('returns 401 when no session has ever been bootstrapped for this token', async () => {
      const session = new AgentLinkSession(makeState(), {});

      const res = await session.fetch(sessionInfoRequest());

      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('invalid');
    });

    it('returns session info for a live (non-closed, non-expired) session', async () => {
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession({ state: 'paired' });

      const res = await session.fetch(sessionInfoRequest());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.state).toBe('paired');
      expect(body.boundContext).toEqual(CTX);
      expect(typeof body.issuedAtMs).toBe('number');
    });

    it('treats "created" (the normal resting state for an HTTP-only agent) as live', async () => {
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession({ state: 'created' });

      const res = await session.fetch(sessionInfoRequest());

      expect(res.status).toBe(200);
    });

    it('returns 403 once the session has been closed (a peer disconnected)', async () => {
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession({ state: 'closed' });

      const res = await session.fetch(sessionInfoRequest());

      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('expired');
    });

    it('returns 403 once the token TTL has elapsed, even before the alarm has flipped the state flag', async () => {
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession({
        state: 'paired',
        issuedAtMs: Date.now() - 11 * 60 * 1000, // TOKEN_TTL_MS is 10 minutes
      });

      const res = await session.fetch(sessionInfoRequest());

      expect(res.status).toBe(403);
    });

    it('re-hydrates a persisted session (+ its macro socket) after a hibernation wake — ISSUE 3', async () => {
      // A macro's first channel connect bootstraps + persists the session
      // (what fetch()'s WS-upgrade path does; simulated here via storage.put
      // since WebSocketPair isn't available in vitest — see file header).
      const store = new Map<string, unknown>();
      const session = makeSession();
      await makeState(store).storage.put('session', session);

      // Hibernation wake: a brand-new DO instance has lost the in-memory
      // session, but the hibernatable macro socket and the persisted record
      // both survive. BEFORE the fix, GET /session 401'd 'invalid' here
      // (this.session === null) — that was ISSUE 3's ~30s idle "death".
      const macroWs = makeFakeMacroWs();
      const state = makeState(store);
      (state.getWebSockets as any).mockImplementation((tag?: string) =>
        tag === 'macro' ? [macroWs] : [],
      );
      const woken = new AgentLinkSession(state, {});

      const res = await woken.fetch(sessionInfoRequest());

      expect(res.status).toBe(200);
      expect((await res.json()).boundContext).toEqual(CTX);
      // The macro socket is re-hydrated too, so agent ops can still forward.
      expect((woken as any).macroSocket).toBe(macroWs);
    });
  });

  describe('POST /agent-op', () => {
    it('returns 401 when no session has ever been bootstrapped for this token', async () => {
      const session = new AgentLinkSession(makeState(), {});

      const res = await session.fetch(agentOpRequest({ id: 'req-1', op: 'read_page', args: {} }));

      expect(res.status).toBe(401);
    });

    it('returns 409 when the session is live but no macro is connected', async () => {
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession();

      const res = await session.fetch(agentOpRequest({ id: 'req-1', op: 'read_page', args: {} }));

      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('macro_not_connected');
    });

    it('returns 400 for a malformed JSON body', async () => {
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession();

      const res = await session.fetch(
        new Request('https://agent-link-do/agent-op', { method: 'POST', body: '{not json' }),
      );

      expect(res.status).toBe(400);
    });

    it('returns 400 when "id" or "op" is missing from the body', async () => {
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession();

      const res = await session.fetch(agentOpRequest({ op: 'read_page' }));

      expect(res.status).toBe(400);
    });

    it('resolves 200 {ok:true,payload} when a matching-id "result" envelope arrives from the macro', async () => {
      const state = makeState();
      const macroWs = makeFakeMacroWs();
      (state.getTags as ReturnType<typeof vi.fn>).mockImplementation((ws: unknown) =>
        ws === macroWs ? ['macro'] : [],
      );

      const session = new AgentLinkSession(state, {});
      (session as any).session = makeSession();
      (session as any).macroSocket = macroWs;

      const responsePromise = session.fetch(agentOpRequest({ id: 'req-1', op: 'read_page', args: {} }));
      await flushMicrotasks();

      expect(macroWs.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(macroWs.send.mock.calls[0][0]);
      expect(sent).toEqual({ kind: 'op', id: 'req-1', op: 'read_page', payload: {} });

      await session.webSocketMessage(
        macroWs as unknown as WebSocket,
        JSON.stringify({ kind: 'result', id: 'req-1', payload: { title: 'Hi' } }),
      );

      const res = await responsePromise;
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, payload: { title: 'Hi' } });
    });

    it('resolves 200 {ok:false,payload} when the macro replies with an "error" envelope', async () => {
      const state = makeState();
      const macroWs = makeFakeMacroWs();
      (state.getTags as ReturnType<typeof vi.fn>).mockImplementation((ws: unknown) =>
        ws === macroWs ? ['macro'] : [],
      );

      const session = new AgentLinkSession(state, {});
      (session as any).session = makeSession();
      (session as any).macroSocket = macroWs;

      const responsePromise = session.fetch(
        agentOpRequest({ id: 'req-2', op: 'update_diagram', args: { dsl: 'A->B: hi' } }),
      );
      await flushMicrotasks();

      await session.webSocketMessage(
        macroWs as unknown as WebSocket,
        JSON.stringify({ kind: 'error', id: 'req-2', payload: { message: 'save failed' } }),
      );

      const res = await responsePromise;
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, payload: { message: 'save failed' } });
    });

    it('does not resolve for a "result" envelope with a different id', async () => {
      const state = makeState();
      const macroWs = makeFakeMacroWs();
      (state.getTags as ReturnType<typeof vi.fn>).mockImplementation((ws: unknown) =>
        ws === macroWs ? ['macro'] : [],
      );

      const session = new AgentLinkSession(state, {});
      (session as any).session = makeSession();
      (session as any).macroSocket = macroWs;

      const responsePromise = session.fetch(agentOpRequest({ id: 'req-3', op: 'read_page', args: {} }));
      await flushMicrotasks();

      await session.webSocketMessage(
        macroWs as unknown as WebSocket,
        JSON.stringify({ kind: 'result', id: 'some-other-id', payload: { title: 'Wrong one' } }),
      );

      // The genuinely-awaited op is still pending — resolve it now to prove
      // the mismatched-id message above was ignored (didn't consume/settle it).
      await session.webSocketMessage(
        macroWs as unknown as WebSocket,
        JSON.stringify({ kind: 'result', id: 'req-3', payload: { title: 'Right one' } }),
      );

      const res = await responsePromise;
      expect(await res.json()).toEqual({ ok: true, payload: { title: 'Right one' } });
    });

    it('times out with 504 if the macro never replies', async () => {
      vi.useFakeTimers();
      try {
        const state = makeState();
        const macroWs = makeFakeMacroWs();
        (state.getTags as ReturnType<typeof vi.fn>).mockImplementation((ws: unknown) =>
          ws === macroWs ? ['macro'] : [],
        );

        const session = new AgentLinkSession(state, {});
        (session as any).session = makeSession();
        (session as any).macroSocket = macroWs;

        const responsePromise = session.fetch(agentOpRequest({ id: 'req-4', op: 'read_page', args: {} }));
        await vi.advanceTimersByTimeAsync(AGENT_OP_TIMEOUT_MS);

        const res = await responsePromise;
        expect(res.status).toBe(504);
        expect((await res.json()).error).toBe('macro_timeout');
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns 409 (not a hung timeout) if the macro socket throws synchronously on send', async () => {
      const state = makeState();
      const macroWs = { send: vi.fn(() => { throw new Error('socket closing'); }) };
      (state.getTags as ReturnType<typeof vi.fn>).mockImplementation((ws: unknown) =>
        ws === macroWs ? ['macro'] : [],
      );

      const session = new AgentLinkSession(state, {});
      (session as any).session = makeSession();
      (session as any).macroSocket = macroWs;

      const res = await session.fetch(agentOpRequest({ id: 'req-5', op: 'read_page', args: {} }));

      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('macro_not_connected');
    });
  });
});
