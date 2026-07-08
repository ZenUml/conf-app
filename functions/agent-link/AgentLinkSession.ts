// AgentLinkSession — Durable Object SHELL for the Live Agent Link relay.
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.2 (relay
// components), §7 (session state machine), §13.1 (transport spike — the
// riskiest assumption this class exists to eventually resolve).
//
// Scope of THIS task: the pure session core (`sessionToken.ts`,
// `sessionRegistry.ts`) and the `POST /agent-link/session` endpoint
// (`session.ts`) are fully implemented and unit tested. This file is a
// structural shell only — the live WebSocket runtime is deferred to a later
// task. `fetch` intentionally returns 501; nothing here talks to a socket yet.
//
// Planned `fetch` behavior once implemented:
//   (a) Macro side: `GET /agent-link/channel?token=...` with an
//       `Upgrade: websocket` header. Validate the token against the bound
//       SessionRecord (created by `session.ts`), accept a `WebSocketPair`,
//       keep the server end as `this.macroSocket`, call
//       `transition('macro_connected')`.
//   (b) Agent side: the hosted MCP proxy (`functions/agent-link/mcp.ts`, not
//       yet built) presents the same token to pair. Once both sockets are
//       present, call `transition('agent_paired')` (created -> paired).
//   (c) Forwarding: any message from one socket is relayed verbatim to the
//       other. A message that carries an edit (`update_diagram`) also calls
//       `transition('edit')` (paired -> active; active -> active).
//   (d) Teardown: `webSocketClose` / `webSocketError` on either socket calls
//       `transition('disconnect')` (-> closed) and closes both sockets.
//   (e) Idle/TTL: a Durable Object `alarm()` checks `isExpired` on the bound
//       token and calls `transition('expire')` when the agent never paired
//       (created/paired -> expired).

import { nextState } from './sessionToken';
import type { SessionEvent, SessionRecord } from './sessionToken';

interface Env {
  // TODO(agent-link): bind AGENT_LINK_SESSION: DurableObjectNamespace in
  // wrangler.toml once this class is wired up for real traffic.
}

export class AgentLinkSession {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  // Populated once the DO is actually wired to a session (later task).
  private session: SessionRecord | null = null;
  private macroSocket: WebSocket | null = null;
  private agentSocket: WebSocket | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /**
   * Drives the session state machine — the single place `fetch`'s future WS
   * handlers should call into, so every state change goes through the same
   * pure `nextState` transition used by `SessionRegistry`.
   */
  private transition(event: SessionEvent): void {
    if (!this.session) return;
    this.session.state = nextState(this.session.state, event);
  }

  async fetch(_request: Request): Promise<Response> {
    // TODO(agent-link): implement the WS upgrade + pairing + forwarding plan
    // documented above:
    //   - branch on `_request.headers.get('Upgrade') === 'websocket'`
    //   - `new WebSocketPair()`, `this.state.acceptWebSocket(server, [tag])`
    //   - route by `?token=` and `?role=macro|agent` query params
    //   - use `isExpired` (sessionToken.ts) inside `alarm()` to fire 'expire'
    // Left unimplemented deliberately — see file header for what this task
    // covers vs defers.
    return new Response('AgentLinkSession: not yet implemented', { status: 501 });
  }
}
