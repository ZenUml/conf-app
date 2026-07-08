// AgentLinkSession — the Live Agent Link relay's Durable Object.
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.2 (relay
// components), §7 (session state machine), §13.1 (transport spike this class
// exists to eventually resolve).
//
// Scope of the WS-pairing task: real pairing + forwarding logic, delegating
// every decision to the pure helpers in `forwarding.ts`
// (parse/route/applyEvent) and `sessionToken.ts` (nextState/isExpired) so
// those are the tested code paths (forwarding.spec.ts). The live WebSocket
// runtime itself — actually accepting a socket, hibernation callbacks
// firing, `alarm()` firing on schedule — is NOT unit-testable without a real
// Workers runtime; it is verified at deploy time (see the DO-binding note
// below).
//
// Scope of THIS task (agent-side HTTP transport): real MCP clients don't
// speak raw WebSocket, so the agent side now reaches this DO over plain
// HTTP instead of a `peer=agent` WS connection (see `mcp.ts`). Two internal
// routes added for that:
//   - `GET /session`   — auth-only: does a token minted by the macro side
//     and bootstrapped into this DO still identify a live (not closed/
//     expired) session? Returns the session's boundContext/issuedAtMs/state
//     so `mcp.ts` can authenticate cross-isolate (fixing the bug where the
//     old in-memory `sessionRegistry` 401'd whenever the mint request and
//     the mcp request landed on different Worker isolates — this DO,
//     addressed by `idFromName(token)`, is the same instance either way).
//   - `POST /agent-op` — auth + forward: sends `{kind:'op',...}` to the
//     macro socket and resolves once the matching `result`/`error` envelope
//     arrives (or after a timeout), so one HTTP request/response round-trips
//     an entire tool-call through the paired macro. Id-correlation is
//     handled by `pendingOps.ts` (a plain Map + setTimeout, not DO-specific,
//     so it's unit-tested directly — see pendingOps.spec.ts — instead of
//     needing a live Workers runtime).
// The agent never opens a `peer=agent` WebSocket in this model, so a
// session's state machine now normally sits at 'created' indefinitely once
// the macro connects (nothing ever fires the `agent_paired`/`edit` events
// for an HTTP-only agent) — `validateSession()` below treats 'created' as
// live, same as 'paired'/'active', and only rejects 'closed'/'expired'.
// Driving the state machine from the HTTP path (so telemetry reflects
// "active" once real tool-calls start flowing) is left as a follow-up; it
// doesn't affect whether calls actually reach the macro.
//
// Wire protocol (matches forwarding.ts's Envelope):
//   GET /agent-link/channel?token=<token>&peer=macro|agent  (Upgrade: websocket)
//   Once both peers are connected, each raw string message one peer sends is
//   parsed (parseEnvelope), routed (routeMessage), and forwarded verbatim to
//   the other peer's socket; routing also drives the session state machine
//   (applyEvent). 'ping' is swallowed locally (no reply needed — the Workers
//   runtime's own WebSocket keepalive covers the transport level; this is an
//   application-level liveness envelope some clients may still send).
//
// DO-binding note: Pages cannot host a Durable Object class internally.
// Verified via wrangler's own Pages config validator (wrangler-dist/cli.js,
// `validateDurableObjectBinding2`): "Pages requires Durable Object bindings
// to specify the name of the Worker where the Durable Object is defined"
// (i.e. a `script_name` pointing at a SEPARATELY DEPLOYED Worker — the Pages
// Functions bundler hardcodes `doBindings: []` for exactly this reason).
// Resolved by `workers/agent-link/` — a standalone Worker (`conf-agent-link`,
// deployed as `conf-agent-link-stg` / `conf-agent-link-prod`) whose
// `src/index.ts` re-exports this class so it's actually defined and
// deployed there, with a `[[migrations]]` entry
// (`new_sqlite_classes = ["AgentLinkSession"]`) in that Worker's
// `wrangler.toml`. The Pages project's wrangler-stg.toml / wrangler-prod.toml
// each carry a `[[env.production.durable_objects.bindings]]` with
// `script_name` pointing at that Worker, and
// `functions/agent-link/channel.ts` now calls the real `env.AGENT_LINK`
// binding (its `!env.AGENT_LINK` guard remains only as a defensive check for
// wrangler-dev.toml, which has no companion Worker for local dev).

import { applyEvent, parseEnvelope, routeMessage } from './forwarding';
import type { Peer } from './forwarding';
import { PendingOps } from './pendingOps';
import type { PendingOpResult } from './pendingOps';
import { isExpired, nextState } from './sessionToken';
import type { BoundContext, SessionRecord, SessionState } from './sessionToken';

interface Env {
  // TODO(agent-link): bind AGENT_LINK: DurableObjectNamespace once a
  // companion Worker exporting this class is deployed (see file header).
}

/** Sent back to a peer when the other side isn't connected yet, or on a malformed message. */
function errorEnvelope(reason: string, id?: string): string {
  return JSON.stringify({ kind: 'error', id, payload: { message: reason } });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** How long `POST /agent-op` waits for the macro's `result`/`error` reply before returning 504. */
export const AGENT_OP_TIMEOUT_MS = 20_000;

type SessionAuthFailure = { ok: false; status: number; code: 'invalid' | 'expired' };
type SessionAuth = { ok: true } | SessionAuthFailure;

export class AgentLinkSession {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  // Populated once the DO has been minted for a real session (via the
  // `POST /agent-link/session` bootstrap data the macro carries into its
  // very first `GET .../channel` call — see `fetch` below).
  private session: SessionRecord | null = null;
  private macroSocket: WebSocket | null = null;
  private agentSocket: WebSocket | null = null;

  // Id-correlation for the HTTP agent-op bridge (`POST /agent-op` below) —
  // see the file header and pendingOps.ts.
  private readonly pendingOps = new PendingOps();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private socketFor(peer: Peer): WebSocket | null {
    return peer === 'macro' ? this.macroSocket : this.agentSocket;
  }

  private setSocketFor(peer: Peer, ws: WebSocket): void {
    if (peer === 'macro') this.macroSocket = ws;
    else this.agentSocket = ws;
  }

  private otherPeer(peer: Peer): Peer {
    return peer === 'macro' ? 'agent' : 'macro';
  }

  /** Drives the session state machine via the shared pure `nextState` (design §7). */
  private transition(event: Parameters<typeof nextState>[1]): SessionState | undefined {
    if (!this.session) return undefined;
    this.session.state = nextState(this.session.state, event);
    return this.session.state;
  }

  /**
   * `GET /agent-link/channel?token=...&peer=macro|agent` with
   * `Upgrade: websocket`. The first caller for a given token (normally the
   * macro, per design §4.3 step 2) bootstraps `this.session` from the query
   * string's bound-context params — the DO has no other side channel to
   * `session.ts`'s registry, since in production each lives in a different
   * isolate; the token + bound context are carried on the URL instead.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Agent-side HTTP transport (mcp.ts) — neither of these is a WebSocket
    // upgrade, so they're handled before the Upgrade check below.
    if (url.pathname === '/session' && request.method === 'GET') {
      return this.handleSessionInfo();
    }
    if (url.pathname === '/agent-op' && request.method === 'POST') {
      return this.handleAgentOp(request);
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket Upgrade request', { status: 426 });
    }

    const token = url.searchParams.get('token');
    const peerParam = url.searchParams.get('peer');
    if (!token || (peerParam !== 'macro' && peerParam !== 'agent')) {
      return new Response('Missing or invalid "token"/"peer" query params', { status: 400 });
    }
    const peer: Peer = peerParam;

    if (!this.session) {
      const cloudId = url.searchParams.get('cloudId');
      const pageId = url.searchParams.get('pageId');
      const contentId = url.searchParams.get('contentId');
      if (!cloudId || !pageId || !contentId) {
        return new Response(
          'First channel connection for a session must include cloudId/pageId/contentId',
          { status: 400 },
        );
      }
      const boundContext: BoundContext = { cloudId, pageId, contentId };
      this.session = {
        token,
        boundContext,
        scope: 'read-page+write-diagram',
        issuedAtMs: Date.now(),
        state: 'created',
      };
      // TTL fallback in case the macro connects but the agent never does —
      // §7: "created -> expired (token TTL, agent never joined)".
      await this.state.storage.setAlarm(this.session.issuedAtMs + 10 * 60 * 1000);
    } else if (this.session.token !== token) {
      return new Response('Token does not match this session', { status: 403 });
    }

    if (this.session.state === 'closed' || this.session.state === 'expired') {
      return new Response(`Session is ${this.session.state}`, { status: 410 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernatable WebSockets: the runtime wakes this DO and calls
    // webSocketMessage/webSocketClose/webSocketError below instead of us
    // holding an in-memory event listener, so the pairing survives the DO
    // going idle between messages. Tag the socket with its peer role so
    // those handlers (which only receive the WebSocket, not our call stack)
    // can tell which side it's for.
    this.state.acceptWebSocket(server, [peer]);
    this.setSocketFor(peer, server);

    this.transition(peer === 'macro' ? 'macro_connected' : 'agent_paired');

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Identifies which peer a hibernated socket belongs to via its accept-time tag. */
  private peerForSocket(ws: WebSocket): Peer | undefined {
    const tags = this.state.getTags?.(ws) ?? [];
    if (tags.includes('macro')) return 'macro';
    if (tags.includes('agent')) return 'agent';
    return undefined;
  }

  /**
   * Shared auth gate for both HTTP routes below: is there a session bound to
   * this DO (i.e. did a macro ever bootstrap one via `GET /channel`?), and is
   * it still live? "Live" here means not 'closed' (a peer disconnected —
   * `teardown` below) and not past its token TTL, checked against the clock
   * rather than trusting the 'expired' state flag, which is only set once
   * the alarm fires and may lag the real deadline slightly.
   *
   * Deliberately does NOT require 'paired'/'active' — an HTTP-only agent
   * (mcp.ts) never opens a `peer=agent` WebSocket, so nothing ever drives
   * those transitions; 'created' is a normal, permanently-valid state for
   * this transport (see file header).
   */
  private validateSession(): SessionAuth {
    if (!this.session) return { ok: false, status: 401, code: 'invalid' };
    if (this.session.state === 'closed' || this.session.state === 'expired') {
      return { ok: false, status: 403, code: 'expired' };
    }
    if (isExpired(this.session.issuedAtMs, Date.now())) {
      return { ok: false, status: 403, code: 'expired' };
    }
    return { ok: true };
  }

  /**
   * `GET /session` internal route — auth-only, no macro-connectivity
   * requirement. Replaces the old cross-isolate-broken
   * `sessionRegistry.get(token)` lookup: `mcp.ts`
   * calls this (via `env.AGENT_LINK.get(idFromName(token))`, the same DO
   * instance the macro bootstrapped) to authenticate a token regardless of
   * which Worker isolate the HTTP request landed on.
   */
  private handleSessionInfo(): Response {
    const auth = this.validateSession();
    if (!auth.ok) return jsonResponse({ error: auth.code }, auth.status);

    const session = this.session as SessionRecord; // validateSession() guarantees non-null here
    return jsonResponse(
      { state: session.state, boundContext: session.boundContext, issuedAtMs: session.issuedAtMs },
      200,
    );
  }

  /**
   * `POST /agent-op` — the real agent-tool-call bridge (mcp.ts's
   * `tools/call`). Body: `{id, op, args}`. Auths the same way as `/session`,
   * then requires a live macro socket (409 if none), sends
   * `{kind:'op',id,op,payload:args}` to it, and awaits the matching
   * `result`/`error` envelope via `pendingOps` (resolved in
   * `webSocketMessage` below) up to `AGENT_OP_TIMEOUT_MS` (504 past that).
   */
  private async handleAgentOp(request: Request): Promise<Response> {
    const auth = this.validateSession();
    if (!auth.ok) return jsonResponse({ error: auth.code }, auth.status);

    let body: { id?: unknown; op?: unknown; args?: unknown };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid_body' }, 400);
    }
    const { id, op, args } = body ?? {};
    if (typeof id !== 'string' || !id || typeof op !== 'string' || !op) {
      return jsonResponse({ error: 'invalid_body' }, 400);
    }

    if (!this.macroSocket) {
      return jsonResponse({ error: 'macro_not_connected' }, 409);
    }

    const envelope = JSON.stringify({ kind: 'op', id, op, payload: args ?? {} });
    const outcome = this.pendingOps.register(id, AGENT_OP_TIMEOUT_MS);

    try {
      this.macroSocket.send(envelope);
    } catch {
      // Socket looked connected but the send itself failed (e.g. already
      // closing) — don't make the caller wait out the full timeout for a
      // message that never went anywhere.
      this.pendingOps.cancel(id);
      return jsonResponse({ error: 'macro_not_connected' }, 409);
    }

    const result = await outcome;
    if ('timedOut' in result) {
      return jsonResponse({ error: 'macro_timeout' }, 504);
    }
    return jsonResponse({ ok: result.ok, payload: result.payload }, 200);
  }

  /**
   * Runtime entry point for every message on either hibernatable socket.
   * Parses -> routes -> forwards verbatim -> updates state, all via the
   * pure helpers in forwarding.ts / sessionToken.ts.
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const from = this.peerForSocket(ws);
    if (!from || !this.session) return;

    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const envelope = parseEnvelope(raw);

    if (envelope.kind === 'invalid') {
      ws.send(errorEnvelope(`invalid message: ${envelope.reason}`));
      return;
    }

    // An in-flight HTTP `/agent-op` call (mcp.ts's agent, no WebSocket peer
    // in this transport) may be awaiting exactly this reply. Resolve it IN
    // ADDITION to the WS-peer forwarding below — a real `peer=agent` socket,
    // if one is ever also connected, still gets the raw envelope forwarded
    // per the pre-existing logic; this just also settles the HTTP side.
    if (from === 'macro' && envelope.id && (envelope.kind === 'result' || envelope.kind === 'error')) {
      const payload: PendingOpResult = { ok: envelope.kind === 'result', payload: envelope.payload };
      this.pendingOps.resolve(envelope.id, payload);
    }

    const decision = routeMessage(from, envelope);
    this.session.state = applyEvent(this.session.state, envelope, from);

    if ('drop' in decision) {
      // 'ping' is a silent no-op; 'unknown' (wrong-direction / malformed
      // kind) is told back to the sender so a buggy client can see why its
      // message never arrived on the other side.
      if (decision.drop === 'unknown') {
        ws.send(errorEnvelope(`message not routed: ${decision.drop}`, envelope.id));
      }
      return;
    }

    const target = this.socketFor(decision.to);
    if (!target) {
      // Other peer isn't connected (yet, or ever). Tell the sender rather
      // than silently swallowing an op/result — design §11 "session_closed"-
      // style honesty: never claim success for a message that went nowhere.
      ws.send(errorEnvelope(`${decision.to} is not connected`, envelope.id));
      return;
    }
    target.send(raw);
  }

  /** Either socket closing tears down the whole pairing (design §4.5, §7). */
  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.teardown(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.teardown(ws);
  }

  private async teardown(closedSocket: WebSocket): Promise<void> {
    this.transition('disconnect');

    const closedPeer = this.peerForSocket(closedSocket);
    const otherPeer = closedPeer ? this.otherPeer(closedPeer) : undefined;
    const other = otherPeer ? this.socketFor(otherPeer) : undefined;
    try {
      other?.close(1000, 'peer disconnected');
    } catch {
      // Already closed/closing — nothing more to do.
    }

    this.macroSocket = null;
    this.agentSocket = null;
    await this.state.storage.deleteAlarm();
  }

  /**
   * TTL enforcement (design §7 "created -> expired (token TTL, agent never
   * joined)"). Scheduled from `fetch` at session bootstrap; also acts as a
   * backstop idle-timeout since it re-arms are not scheduled past the
   * initial TTL window in this task's scope (see TODO above re: idle
   * timeout duration — design §14 open question 1).
   */
  async alarm(): Promise<void> {
    if (!this.session) return;
    if (isExpired(this.session.issuedAtMs, Date.now())) {
      this.session.state = nextState(this.session.state, 'expire');
      try {
        this.macroSocket?.close(1000, 'session expired');
      } catch {
        /* already closed */
      }
      try {
        this.agentSocket?.close(1000, 'session expired');
      } catch {
        /* already closed */
      }
      this.macroSocket = null;
      this.agentSocket = null;
    }
  }
}
