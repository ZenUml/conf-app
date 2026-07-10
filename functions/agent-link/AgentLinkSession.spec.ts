import { describe, it, expect, vi } from 'vitest';
import { AgentLinkSession, AGENT_OP_TIMEOUT_MS } from './AgentLinkSession';
import { TOKEN_TTL_MS } from './sessionToken';
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

  describe('diagram snapshot cache (relay-side update_diagram guardrail baseline)', () => {
    function connectedSession(store = new Map<string, unknown>()) {
      const state = makeState(store);
      const macroWs = makeFakeMacroWs();
      (state.getTags as ReturnType<typeof vi.fn>).mockImplementation((ws: unknown) =>
        ws === macroWs ? ['macro'] : [],
      );
      const session = new AgentLinkSession(state, {});
      (session as any).session = makeSession();
      (session as any).macroSocket = macroWs;
      return { session, macroWs, store };
    }

    it('caches {diagramType, dsl} from a read_diagram result and surfaces it on GET /session', async () => {
      const { session, macroWs, store } = connectedSession();

      const opPromise = session.fetch(agentOpRequest({ id: 'r-1', op: 'read_diagram', args: {} }));
      await flushMicrotasks();
      await session.webSocketMessage(
        macroWs as unknown as WebSocket,
        JSON.stringify({ kind: 'result', id: 'r-1', payload: { diagramType: 'Sequence', dsl: 'A->B: hi' } }),
      );
      await opPromise;

      // Persisted for hibernation survival...
      expect(store.get('lastDiagram')).toEqual({ diagramType: 'Sequence', dsl: 'A->B: hi' });
      // ...and surfaced to the relay on the auth round-trip.
      const info = await (await session.fetch(sessionInfoRequest())).json();
      expect(info.lastDiagram).toEqual({ diagramType: 'Sequence', dsl: 'A->B: hi' });
    });

    it('refreshes the cached dsl after a successful update_diagram (keeps diagramType)', async () => {
      const { session, macroWs, store } = connectedSession();
      // Seed a prior read so the diagramType is known.
      (session as any).lastDiagram = { diagramType: 'Sequence', dsl: 'A->B: old' };

      const opPromise = session.fetch(
        agentOpRequest({ id: 'u-1', op: 'update_diagram', args: { dsl: 'A->B: new\nB->C: more' } }),
      );
      await flushMicrotasks();
      await session.webSocketMessage(
        macroWs as unknown as WebSocket,
        JSON.stringify({ kind: 'result', id: 'u-1', payload: { ok: true, version: 2 } }),
      );
      await opPromise;

      expect(store.get('lastDiagram')).toEqual({ diagramType: 'Sequence', dsl: 'A->B: new\nB->C: more' });
    });

    it('does not cache when the op reply is an error (no state change)', async () => {
      const { session, macroWs, store } = connectedSession();

      const opPromise = session.fetch(agentOpRequest({ id: 'e-1', op: 'read_diagram', args: {} }));
      await flushMicrotasks();
      await session.webSocketMessage(
        macroWs as unknown as WebSocket,
        JSON.stringify({ kind: 'error', id: 'e-1', payload: { message: 'boom' } }),
      );
      await opPromise;

      expect(store.get('lastDiagram')).toBeUndefined();
    });

    it('does NOT cache a by-contentId (discovery) read_diagram — it would poison the bound guardrail baseline (Track U/S5)', async () => {
      const { session, macroWs, store } = connectedSession();
      // Seed the bound baseline from a prior bound read.
      (session as any).lastDiagram = { diagramType: 'Sequence', dsl: 'A->B: bound' };

      // The agent reads a DIFFERENT diagram it discovered (contentId != bound
      // 'content-1'). The macro replies with that other diagram's DSL.
      const opPromise = session.fetch(
        agentOpRequest({ id: 'd-1', op: 'read_diagram', args: { contentId: 'other-99' } }),
      );
      await flushMicrotasks();
      await session.webSocketMessage(
        macroWs as unknown as WebSocket,
        JSON.stringify({ kind: 'result', id: 'd-1', payload: { diagramType: 'mermaid', dsl: 'graph TD; X-->Y' } }),
      );
      await opPromise;

      // Baseline unchanged — the discovered diagram's DSL never overwrote it.
      expect((session as any).lastDiagram).toEqual({ diagramType: 'Sequence', dsl: 'A->B: bound' });
      expect(store.get('lastDiagram')).toBeUndefined();
    });

    it('still caches a bound-diagram read_diagram that explicitly passes the bound contentId', async () => {
      const { session, macroWs, store } = connectedSession();

      const opPromise = session.fetch(
        agentOpRequest({ id: 'b-1', op: 'read_diagram', args: { contentId: 'content-1' } }),
      );
      await flushMicrotasks();
      await session.webSocketMessage(
        macroWs as unknown as WebSocket,
        JSON.stringify({ kind: 'result', id: 'b-1', payload: { diagramType: 'Sequence', dsl: 'A->B: hi' } }),
      );
      await opPromise;

      expect(store.get('lastDiagram')).toEqual({ diagramType: 'Sequence', dsl: 'A->B: hi' });
    });
  });

  // --- session lifecycle: suspend / reattach / explicit-close (Track G) ----
  //
  // webSocketClose/webSocketError/webSocketMessage are driven directly here
  // (same `(session as any).session = ...` / `(session as any).macroSocket =
  // ...` pattern as the rest of this file) rather than through `fetch()`'s
  // WebSocketPair-upgrade path, which — per this file's own header comment —
  // needs a real Workers runtime and isn't exercised anywhere in this spec.

  function macroConnectedSession(state: ReturnType<typeof makeState> = makeState(), overrides: Partial<SessionRecord> = {}) {
    const macroWs = makeFakeMacroWs();
    (state.getTags as ReturnType<typeof vi.fn>).mockImplementation((ws: unknown) =>
      ws === macroWs ? ['macro'] : [],
    );
    const session = new AgentLinkSession(state, {});
    (session as any).session = makeSession(overrides);
    (session as any).macroSocket = macroWs;
    return { session, macroWs, state };
  }

  describe('webSocketClose / webSocketError — accidental disconnect suspends, not closes', () => {
    it('a macro socket closing unexpectedly suspends the session (keeps the record, drops the socket)', async () => {
      const store = new Map<string, unknown>();
      const state = makeState(store);
      const { session, macroWs } = macroConnectedSession(state, { state: 'paired' });

      await session.webSocketClose(macroWs as unknown as WebSocket);

      expect((session as any).session.state).toBe('suspended');
      expect((session as any).macroSocket).toBeNull();
      // The record survives — a hibernation wake must still see 'suspended'
      // (this is the whole point of suspend vs the old full-teardown).
      expect((store.get('session') as SessionRecord).state).toBe('suspended');
      expect(store.has('session')).toBe(true);
    });

    it('a macro socket erroring unexpectedly also suspends (same as close)', async () => {
      const { session, macroWs } = macroConnectedSession(undefined as any, { state: 'active' });

      await session.webSocketError(macroWs as unknown as WebSocket);

      expect((session as any).session.state).toBe('suspended');
    });

    it('GET /session reports "suspended" (still authenticated, not rejected) after an accidental drop', async () => {
      const state = makeState();
      const { session, macroWs } = macroConnectedSession(state, { state: 'active' });
      await session.webSocketClose(macroWs as unknown as WebSocket);

      const res = await session.fetch(sessionInfoRequest());

      expect(res.status).toBe(200);
      expect((await res.json()).state).toBe('suspended');
    });

    it('a closed/expired session ignores a subsequent socket close (terminal, nothing to suspend)', async () => {
      const { session, macroWs } = macroConnectedSession(undefined as any, { state: 'closed' });

      await session.webSocketClose(macroWs as unknown as WebSocket);

      expect((session as any).session.state).toBe('closed');
    });

    it('the vestigial agent-peer socket closing does not suspend or affect the macro pairing', async () => {
      const state = makeState();
      const agentWs = { send: vi.fn() };
      (state.getTags as ReturnType<typeof vi.fn>).mockImplementation((ws: unknown) =>
        ws === agentWs ? ['agent'] : [],
      );
      const session = new AgentLinkSession(state, {});
      (session as any).session = makeSession({ state: 'active' });
      (session as any).agentSocket = agentWs;

      await session.webSocketClose(agentWs as unknown as WebSocket);

      expect((session as any).session.state).toBe('active');
      expect((session as any).agentSocket).toBeNull();
    });
  });

  describe('explicit disconnect envelope — the only path to "closed"', () => {
    it('a {kind:"disconnect"} message from the macro closes the session (terminal) and wipes storage', async () => {
      const store = new Map<string, unknown>();
      const state = makeState(store);
      const { session, macroWs } = macroConnectedSession(state, { state: 'active' });

      await session.webSocketMessage(macroWs as unknown as WebSocket, JSON.stringify({ kind: 'disconnect' }));

      expect((session as any).session.state).toBe('closed');
      expect((session as any).macroSocket).toBeNull();
      expect(store.has('session')).toBe(false);
    });

    it('closes the OTHER peer socket too when one side sends an explicit disconnect', async () => {
      const state = makeState();
      const macroWs = makeFakeMacroWs();
      const agentWs = { send: vi.fn(), close: vi.fn() };
      (state.getTags as ReturnType<typeof vi.fn>).mockImplementation((ws: unknown) => {
        if (ws === macroWs) return ['macro'];
        if (ws === agentWs) return ['agent'];
        return [];
      });
      const session = new AgentLinkSession(state, {});
      (session as any).session = makeSession({ state: 'active' });
      (session as any).macroSocket = macroWs;
      (session as any).agentSocket = agentWs;

      await session.webSocketMessage(macroWs as unknown as WebSocket, JSON.stringify({ kind: 'disconnect' }));

      expect(agentWs.close).toHaveBeenCalled();
    });

    it('a subsequent accidental close after an explicit disconnect is a no-op (already terminal)', async () => {
      const { session, macroWs } = macroConnectedSession(undefined as any, { state: 'active' });

      await session.webSocketMessage(macroWs as unknown as WebSocket, JSON.stringify({ kind: 'disconnect' }));
      await session.webSocketClose(macroWs as unknown as WebSocket);

      expect((session as any).session.state).toBe('closed');
    });
  });

  describe('POST /agent-op while suspended — structured retriable error, get_status still succeeds', () => {
    it('get_status while suspended reports {state:"suspended", resume_deadline} instead of erroring', async () => {
      const issuedAtMs = Date.now();
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession({ state: 'suspended', issuedAtMs });

      const res = await session.fetch(agentOpRequest({ id: 'r-1', op: 'get_status', args: {} }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.payload.state).toBe('suspended');
      expect(body.payload.resume_deadline).toBe(issuedAtMs + TOKEN_TTL_MS);
    });

    it('every other op returns a structured, retriable macro_disconnected error (not queued)', async () => {
      const issuedAtMs = Date.now();
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession({ state: 'suspended', issuedAtMs });
      // A macro socket must NOT be required/consulted while suspended — the
      // op is rejected before ever touching macroSocket.
      (session as any).macroSocket = null;

      const res = await session.fetch(agentOpRequest({ id: 'u-1', op: 'update_diagram', args: { dsl: 'A->B: hi' } }));

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('macro_disconnected');
      expect(body.resume_deadline).toBe(issuedAtMs + TOKEN_TTL_MS);
    });

    it('read_page and read_diagram also get macro_disconnected while suspended', async () => {
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession({ state: 'suspended' });

      for (const op of ['read_page', 'read_diagram']) {
        const res = await session.fetch(agentOpRequest({ id: `id-${op}`, op, args: {} }));
        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe('macro_disconnected');
      }
    });

    it('the Track U discovery ops (search_diagrams / list_diagrams) also get macro_disconnected while suspended', async () => {
      const issuedAtMs = Date.now();
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession({ state: 'suspended', issuedAtMs });
      // No macro socket must be needed to reject — the suspended guard fires
      // before any forwarding, exactly as for read/update ops.
      (session as any).macroSocket = null;

      for (const op of ['search_diagrams', 'list_diagrams']) {
        const res = await session.fetch(
          agentOpRequest({ id: `s-${op}`, op, args: { query: 'payment' } }),
        );
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe('macro_disconnected');
        expect(body.resume_deadline).toBe(issuedAtMs + TOKEN_TTL_MS);
      }
    });
  });

  describe('POST /agent-op get_status while LIVE — answered by the DO, never forwarded (2026-07-10 spot-check regression)', () => {
    it('returns link status from the session record without touching the macro socket', async () => {
      const issuedAtMs = Date.now();
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession({ state: 'active', issuedAtMs });
      const macroWs = makeFakeMacroWs();
      (session as any).macroSocket = macroWs;
      (session as any).lastDiagram = { diagramType: 'sequence', dsl: 'A->B: hi' };

      const res = await session.fetch(agentOpRequest({ id: 'g-live-1', op: 'get_status', args: {} }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.payload.state).toBe('active');
      expect(body.payload.connected).toBe(true);
      expect(body.payload.pageId).toBe('page-1');
      expect(body.payload.contentId).toBe('content-1');
      expect(body.payload.diagramType).toBe('sequence');
      expect(body.payload.expiresInSec).toBeGreaterThan(0);
      expect(body.payload.expiresInSec).toBeLessThanOrEqual(600);
      // The bug this pins: get_status used to be forwarded to the macro, whose
      // op dispatcher (relayClient) has no get_status case — every live call
      // failed with "unsupported op: get_status". Nothing may cross the socket.
      expect(macroWs.send).not.toHaveBeenCalled();
    });

    it('still answers connected:false when live but the macro socket is gone', async () => {
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession({ state: 'active' });
      (session as any).macroSocket = null;

      const res = await session.fetch(agentOpRequest({ id: 'g-live-2', op: 'get_status', args: {} }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.payload.connected).toBe(false);
    });
  });

  // --- per-contentId mint exclusivity (Track G, design §7 decision #2) -----
  //
  // Exercised against a SEPARATE DO instance of this same class — the
  // content-lock instance never has `this.session` populated; only
  // `/content-claim` and `/content-release` are relevant to it.

  function contentClaimRequest(body: unknown): Request {
    return new Request('https://agent-link-do/content-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function contentReleaseRequest(body: unknown): Request {
    return new Request('https://agent-link-do/content-release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  describe('POST /content-claim / /content-release — per-contentId mint exclusivity', () => {
    it('claims a lock for a fresh contentId', async () => {
      const lock = new AgentLinkSession(makeState(), {});

      const res = await lock.fetch(contentClaimRequest({ token: 'CL-AAAA-1111', expiresAt: Date.now() + 60_000 }));

      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it('rejects a second token claiming a still-live lock with diagram_already_linked (409)', async () => {
      const store = new Map<string, unknown>();
      const lock = new AgentLinkSession(makeState(store), {});
      await lock.fetch(contentClaimRequest({ token: 'CL-AAAA-1111', expiresAt: Date.now() + 60_000 }));

      const res = await lock.fetch(contentClaimRequest({ token: 'CL-BBBB-2222', expiresAt: Date.now() + 60_000 }));

      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('diagram_already_linked');
      // The original claim is untouched.
      expect((store.get('contentLock') as { token: string }).token).toBe('CL-AAAA-1111');
    });

    it('the SAME token re-claiming (e.g. a reattach) is allowed, not rejected as a duplicate', async () => {
      const lock = new AgentLinkSession(makeState(), {});
      await lock.fetch(contentClaimRequest({ token: 'CL-AAAA-1111', expiresAt: Date.now() + 60_000 }));

      const res = await lock.fetch(contentClaimRequest({ token: 'CL-AAAA-1111', expiresAt: Date.now() + 120_000 }));

      expect(res.status).toBe(200);
    });

    it('a claim past its own expiresAt is treated as stale — a new token can claim it (no permanent orphan)', async () => {
      const lock = new AgentLinkSession(makeState(), {});
      await lock.fetch(contentClaimRequest({ token: 'CL-AAAA-1111', expiresAt: Date.now() - 1000 }));

      const res = await lock.fetch(contentClaimRequest({ token: 'CL-BBBB-2222', expiresAt: Date.now() + 60_000 }));

      expect(res.status).toBe(200);
    });

    it('a hibernation wake re-loads the persisted claim from storage before deciding', async () => {
      const store = new Map<string, unknown>();
      await makeState(store).storage.put('contentLock', { token: 'CL-AAAA-1111', expiresAt: Date.now() + 60_000 });
      const woken = new AgentLinkSession(makeState(store), {});

      const res = await woken.fetch(contentClaimRequest({ token: 'CL-BBBB-2222', expiresAt: Date.now() + 60_000 }));

      expect(res.status).toBe(409);
    });

    it('releasing with the matching token clears the claim, freeing the contentId for a new mint', async () => {
      const store = new Map<string, unknown>();
      const lock = new AgentLinkSession(makeState(store), {});
      await lock.fetch(contentClaimRequest({ token: 'CL-AAAA-1111', expiresAt: Date.now() + 60_000 }));

      const releaseRes = await lock.fetch(contentReleaseRequest({ token: 'CL-AAAA-1111' }));
      expect(releaseRes.status).toBe(200);
      expect(store.has('contentLock')).toBe(false);

      const res = await lock.fetch(contentClaimRequest({ token: 'CL-BBBB-2222', expiresAt: Date.now() + 60_000 }));
      expect(res.status).toBe(200);
    });

    it('releasing with a MISMATCHED token is a no-op (a stale/superseded release cannot clobber a newer claim)', async () => {
      const store = new Map<string, unknown>();
      const lock = new AgentLinkSession(makeState(store), {});
      await lock.fetch(contentClaimRequest({ token: 'CL-AAAA-1111', expiresAt: Date.now() + 60_000 }));

      await lock.fetch(contentReleaseRequest({ token: 'CL-WRONG-TOKEN' }));

      expect((store.get('contentLock') as { token: string }).token).toBe('CL-AAAA-1111');
    });
  });

  describe('releaseContentLock — best-effort release from the session DO on close/expire', () => {
    function makeAgentLinkEnv() {
      const releaseCalls: unknown[] = [];
      const lockStub = {
        fetch: async (_url: string, init?: RequestInit) => {
          releaseCalls.push(init?.body ? JSON.parse(init.body as string) : undefined);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      };
      const env = {
        AGENT_LINK: {
          idFromName: (name: string) => ({ name }),
          get: () => lockStub,
        },
      };
      return { env, releaseCalls };
    }

    it('an explicit disconnect releases the per-contentId claim on the content-keyed DO', async () => {
      const { env, releaseCalls } = makeAgentLinkEnv();
      const state = makeState();
      const macroWs = makeFakeMacroWs();
      (state.getTags as ReturnType<typeof vi.fn>).mockImplementation((ws: unknown) =>
        ws === macroWs ? ['macro'] : [],
      );
      const session = new AgentLinkSession(state, env as any);
      (session as any).session = makeSession({ state: 'active' });
      (session as any).macroSocket = macroWs;

      await session.webSocketMessage(macroWs as unknown as WebSocket, JSON.stringify({ kind: 'disconnect' }));

      expect(releaseCalls).toEqual([{ token: 'CL-TEST-TOKN' }]);
    });

    it('a suspended session (accidental drop) does NOT release the claim — it is still linked', async () => {
      const { env, releaseCalls } = makeAgentLinkEnv();
      const { session, macroWs } = macroConnectedSession(makeState(), { state: 'active' });
      (session as any).env = env;

      await session.webSocketClose(macroWs as unknown as WebSocket);

      expect(releaseCalls).toEqual([]);
    });

    it('TTL expiry (alarm) releases the claim', async () => {
      const { env, releaseCalls } = makeAgentLinkEnv();
      const session = new AgentLinkSession(makeState(), env as any);
      (session as any).session = makeSession({ issuedAtMs: Date.now() - 11 * 60 * 1000 });

      await session.alarm();

      expect(releaseCalls).toEqual([{ token: 'CL-TEST-TOKN' }]);
    });

    it('is a no-op without an AGENT_LINK binding (local dev/tests)', async () => {
      const session = new AgentLinkSession(makeState(), {});
      (session as any).session = makeSession({ state: 'active' });
      (session as any).macroSocket = makeFakeMacroWs();

      // Should not throw even though this.env.AGENT_LINK is undefined.
      await expect(
        session.webSocketMessage(
          (session as any).macroSocket as WebSocket,
          JSON.stringify({ kind: 'disconnect' }),
        ),
      ).resolves.toBeUndefined();
    });
  });
});
