// AgentLinkSession — the Live Agent Link relay's Durable Object.
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.2 (relay
// components), §7 (session state machine), §13.1 (transport spike this class
// exists to eventually resolve).
//
// Scope of THIS task: real pairing + forwarding logic, delegating every
// decision to the pure helpers in `forwarding.ts` (parse/route/applyEvent)
// and `sessionToken.ts` (nextState/isExpired) so those are the tested code
// paths (forwarding.spec.ts). The live WebSocket runtime itself — actually
// accepting a socket, hibernation callbacks firing, `alarm()` firing on
// schedule — is NOT unit-testable without a real Workers runtime; it is
// verified at deploy time (see TODO(agent-link) below on the DO binding).
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
// TODO(agent-link): confirm Pages<->DO binding at deploy. Verified via
// wrangler's own Pages config validator (wrangler-dist/cli.js,
// `validateDurableObjectBinding2`): "Pages requires Durable Object bindings
// to specify the name of the Worker where the Durable Object is defined"
// (i.e. a `script_name` pointing at a SEPARATELY DEPLOYED Worker — Pages
// Functions cannot host a Durable Object class internally; the Pages
// Functions bundler hardcodes `doBindings: []` for exactly this reason).
// This repo has no such companion Worker yet, so `[[durable_objects.bindings]]`
// is deliberately NOT added to wrangler-dev.toml/wrangler-stg.toml/
// wrangler-prod.toml in this task — adding a binding without a real
// `script_name` would satisfy the validator (it only checks the field is a
// string) but silently do nothing in production and previously would have
// risked confusing/breaking local `wrangler pages dev`. Next step to make
// this class live: deploy a minimal standalone Worker that exports
// `AgentLinkSession`, then add the binding + a `[[migrations]]` entry
// (`new_sqlite_classes = ["AgentLinkSession"]`) referencing that Worker's
// `script_name` in the Pages project's wrangler config, and swap
// `functions/agent-link/channel.ts`'s guard for the real `env.AGENT_LINK`
// call it already contains.

import { applyEvent, parseEnvelope, routeMessage } from './forwarding';
import type { Peer } from './forwarding';
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

export class AgentLinkSession {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  // Populated once the DO has been minted for a real session (via the
  // `POST /agent-link/session` bootstrap data the macro carries into its
  // very first `GET .../channel` call — see `fetch` below).
  private session: SessionRecord | null = null;
  private macroSocket: WebSocket | null = null;
  private agentSocket: WebSocket | null = null;

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
