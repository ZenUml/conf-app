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

import { applyEvent, parseEnvelope, reattachEvent, routeMessage, statusEnvelope } from './forwarding';
import type { Peer, StatusActivity } from './forwarding';
import { PendingOps } from './pendingOps';
import type { PendingOpResult } from './pendingOps';
import { effectiveExpiryMs, isAtCap, isExpired, MAX_SESSION_MS, nextState } from './sessionToken';
import type { BoundContext, SessionRecord, SessionState } from './sessionToken';

interface Env {
  // Self-referencing binding: the companion Worker (workers/agent-link/)
  // that hosts this class also binds AGENT_LINK to ITSELF, so one DO
  // instance (keyed by token) can reach a DIFFERENT instance of the same
  // class (keyed by `content:<cloudId>:<contentId>`) — used by releaseContentLock()
  // below to release the per-contentId mint-exclusivity claim on
  // close/expire (design §7 decision #2). Optional because unit tests
  // construct this class with `{}` (no binding) — releaseContentLock() is a
  // no-op without it, matching this file's existing "absent in local
  // dev/tests" posture for AGENT_LINK elsewhere (channel.ts, mcp.ts).
  AGENT_LINK?: DurableObjectNamespace;
}

/** The per-contentId mint-exclusivity claim (design §7 decision #2). Lives in a
 * SEPARATE DO instance of this same class, addressed by
 * `content:<cloudId>:<contentId>` rather than a token — see
 * handleContentClaim/handleContentRelease below. */
interface ContentLock {
  token: string;
  expiresAt: number;
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

  // Last-known diagram snapshot ({diagramType, dsl}) for the bound diagram,
  // cached from the agent's read_diagram results and refreshed after each
  // applied update_diagram (see handleAgentOp). Surfaced on GET /session so the
  // relay's update_diagram guardrail (mcp.ts -> updateDiagramGuard.ts) has a
  // synchronous baseline to parse + length-check against, without a separate
  // round-trip. Persisted alongside the session so it survives a hibernation
  // wake (ISSUE-3 companion — reloaded in ensureSession).
  private lastDiagram: { diagramType?: string; dsl?: string } | null = null;

  // Id-correlation for the HTTP agent-op bridge (`POST /agent-op` below) —
  // see the file header and pendingOps.ts.
  private readonly pendingOps = new PendingOps();

  // Per-contentId mint-exclusivity claim (design §7 decision #2). Only ever
  // populated on a DO instance addressed by `content:<cloudId>:<contentId>` — see
  // handleContentClaim/handleContentRelease and ensureContentLock below. A
  // token-keyed instance (the normal WS-pairing session) never touches this.
  private contentLock: ContentLock | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /**
   * Re-hydrate the session (and its hibernatable sockets) after the DO has
   * been evicted from memory. Hibernatable WebSockets survive the DO going
   * idle, but `this.session` / `macroSocket` / `agentSocket` are plain
   * in-memory fields a freshly-woken instance loses — so `validateSession()`
   * would 401 'invalid' on the very next request even though the socket is
   * still open and the pairing intact. That was ISSUE 3: the session appeared
   * to "die" after ~30s idle (the DO hibernated; traffic kept it warm). The
   * record is persisted to storage at bootstrap (see `fetch`) and reloaded
   * here on the first handler call after a wake, so a session survives idle
   * for its full token TTL — exactly what the hibernation comment in `fetch`
   * always intended. No-op once `this.session` is set (warm instance, or a
   * test that populated it directly).
   */
  private async ensureSession(): Promise<void> {
    if (this.session) return;
    const stored = await this.state.storage.get<SessionRecord>('session');
    if (!stored) return;
    this.session = stored;
    // Migration: a record persisted by pre-PR1 code has no lastActivityMs —
    // backfill with issuedAtMs (v1-equivalent deadline) so effectiveExpiryMs
    // never sees undefined (NaN would 403 every live session at deploy time).
    if (typeof (this.session as Partial<SessionRecord>).lastActivityMs !== 'number') {
      this.session.lastActivityMs = this.session.issuedAtMs;
    }
    this.lastDiagram =
      (await this.state.storage.get<{ diagramType?: string; dsl?: string }>('lastDiagram')) ?? null;
    this.macroSocket = this.state.getWebSockets('macro')[0] ?? null;
    this.agentSocket = this.state.getWebSockets('agent')[0] ?? null;
  }

  /** Loads the persisted content-lock claim (if any) — companion to
   * ensureSession() for the content-lock-flavored DO instance (see
   * ContentLock's doc comment). No-op once `this.contentLock` is set. */
  private async ensureContentLock(): Promise<void> {
    if (this.contentLock !== null) return;
    const stored = await this.state.storage.get<ContentLock>('contentLock');
    if (stored) this.contentLock = stored;
  }

  /**
   * `POST /content-claim` — per-contentId mint-time exclusivity (design §7
   * decision #2: "one ACTIVE/SUSPENDED session per contentId"). `session.ts`
   * calls this against a SEPARATE DO instance of this SAME class
   * (`content:<cloudId>:<contentId>`, never a token), so it never touches this
   * instance's `this.session` fields. Atomic per contentId: a Durable Object
   * processes requests to the SAME instance one at a time (never
   * interleaved), so the check-then-set below can't race with a concurrent
   * claim attempt for the same contentId.
   *
   * A claim already held by a DIFFERENT token that hasn't yet passed its own
   * `expiresAt` is rejected with `diagram_already_linked` — TTL-bounded so a
   * claim that's never explicitly released (a crashed mint, a session that
   * never reaches webSocketClose/alarm) still self-clears; no permanent
   * orphan lock (design's staleness-window requirement).
   */
  private async handleContentClaim(request: Request): Promise<Response> {
    let body: { token?: unknown; expiresAt?: unknown };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid_body' }, 400);
    }
    const { token, expiresAt } = body ?? {};
    if (typeof token !== 'string' || !token || typeof expiresAt !== 'number') {
      return jsonResponse({ error: 'invalid_body' }, 400);
    }

    await this.ensureContentLock();
    const now = Date.now();
    if (this.contentLock && this.contentLock.token !== token && this.contentLock.expiresAt > now) {
      // A4 (spec review): surface the held claim's expiry so the mint endpoint
      // can return an honest retry-after instead of a bare 409.
      return jsonResponse(
        { error: 'diagram_already_linked', lock_expires_at: this.contentLock.expiresAt },
        409,
      );
    }

    this.contentLock = { token, expiresAt };
    await this.state.storage.put('contentLock', this.contentLock);
    return jsonResponse({ ok: true }, 200);
  }

  /**
   * `POST /content-release` — best-effort release of the per-contentId claim
   * once its owning session closes/expires (design: "released on
   * closed/expired" — see releaseContentLock below, called from
   * closeSession/alarm). Only releases if the caller's token still matches
   * the current claim, so a stale/late release from an already-superseded
   * session can't clobber a newer one.
   */
  private async handleContentRelease(request: Request): Promise<Response> {
    let body: { token?: unknown };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid_body' }, 400);
    }
    const token = body?.token;

    await this.ensureContentLock();
    if (this.contentLock && this.contentLock.token === token) {
      this.contentLock = null;
      await this.state.storage.delete('contentLock');
    }
    return jsonResponse({ ok: true }, 200);
  }

  /**
   * Best-effort release of THIS session's per-contentId claim, called from a
   * TOKEN-keyed instance against the CONTENT-keyed instance for the same
   * diagram (design: "Wire the release best-effort from the session DO on
   * close/expire"). Swallows every failure (missing binding in local
   * dev/tests, a transient fetch error) — a release that never lands just
   * means the claim self-clears at its own TTL later; it must never block
   * teardown.
   */
  private async releaseContentLock(): Promise<void> {
    if (!this.env.AGENT_LINK || !this.session) return;
    try {
      const lockId = this.env.AGENT_LINK.idFromName(
        `content:${this.session.boundContext.cloudId}:${this.session.boundContext.contentId}`,
      );
      const stub = this.env.AGENT_LINK.get(lockId);
      await stub.fetch('https://agent-link-do/content-release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.session.token }),
      });
    } catch {
      // Best-effort — see doc comment above.
    }
  }

  /**
   * A3 (spec review): on the first real macro connection (session bootstrap),
   * best-effort UPGRADE the per-contentId content lock to the absolute cap.
   * The mint (session.ts) now claims only a 10-min lock so unauthenticated
   * mint-griefing and never-connected orphans can't hold a 60-min lock; a
   * genuine macro connection extends the claim to cover the whole POSSIBLE
   * session lifetime (a sliding session can outlive any 10-min lock, with no
   * refresh path). Mirrors releaseContentLock()'s addressing.
   *
   * Returns whether this session may proceed as the live holder of the lock:
   *   - true  — the claim landed (200) OR there's no binding (local dev/tests)
   *             OR the round-trip failed transiently (best-effort: a failed
   *             re-claim just leaves the mint's 10-min lock to self-clear;
   *             refusing a legitimate connection over a network blip would be
   *             worse than the harmless duplicate the lock guards against).
   *   - false — a DIFFERENT session already owns this diagram's lock (409). The
   *             mint's 10-min claim lapsed and another mint grabbed it in the
   *             gap before this macro connected; proceeding would bootstrap a
   *             SECOND live session for the same contentId, breaking the
   *             one-session-per-contentId exclusivity invariant (design §7
   *             decision #2). Caller refuses the bootstrap. NOT swallowed —
   *             the same-token re-claim (the normal connect, whose token still
   *             owns the mint lock) returns 200, so a 409 is unambiguously
   *             another owner.
   */
  private async claimContentLockAtCap(): Promise<boolean> {
    if (!this.env.AGENT_LINK || !this.session) return true;
    try {
      const lockId = this.env.AGENT_LINK.idFromName(
        `content:${this.session.boundContext.cloudId}:${this.session.boundContext.contentId}`,
      );
      const stub = this.env.AGENT_LINK.get(lockId);
      const res = await stub.fetch('https://agent-link-do/content-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.session.token, expiresAt: Date.now() + MAX_SESSION_MS }),
      });
      return res.status !== 409;
    } catch {
      // Best-effort on a transient failure — see the `true` case above.
      return true;
    }
  }

  /**
   * Snoop a completed agent-op reply to keep `lastDiagram` fresh: a
   * read_diagram result carries the current {diagramType, dsl}; a successful
   * update_diagram means the DSL we forwarded is now the current one. This is
   * the session-cached baseline the update_diagram guardrail (relay-side)
   * parses + length-checks the NEXT edit against.
   */
  private async cacheDiagramFromOp(op: string, args: unknown, payload: unknown): Promise<void> {
    if (op === 'read_diagram') {
      // Track U (S5): read_diagram can now target ANY diagram via a `contentId`
      // arg, not just the bound one. Only the BOUND diagram's DSL is a valid
      // baseline for the update_diagram guardrail (which only ever writes the
      // bound contentId) — caching a discovered hit's DSL here would make the
      // next bound edit diff against the wrong diagram (false data-loss reject,
      // or a missed one). So skip the cache when the read targeted a different
      // contentId; the bound default read (no arg) still refreshes it.
      const readArgs = args as { contentId?: unknown } | null;
      const boundId = this.session?.boundContext?.contentId;
      if (
        readArgs &&
        typeof readArgs.contentId === 'string' &&
        readArgs.contentId &&
        boundId &&
        String(readArgs.contentId) !== String(boundId)
      ) {
        return;
      }
      const p = payload as { diagramType?: unknown; dsl?: unknown } | null;
      if (p && (typeof p.dsl === 'string' || typeof p.diagramType === 'string')) {
        this.lastDiagram = {
          diagramType: typeof p.diagramType === 'string' ? p.diagramType : this.lastDiagram?.diagramType,
          dsl: typeof p.dsl === 'string' ? p.dsl : this.lastDiagram?.dsl,
        };
        await this.state.storage.put('lastDiagram', this.lastDiagram);
      }
    } else if (op === 'update_diagram') {
      const a = args as { dsl?: unknown } | null;
      if (a && typeof a.dsl === 'string') {
        this.lastDiagram = { diagramType: this.lastDiagram?.diagramType, dsl: a.dsl };
        await this.state.storage.put('lastDiagram', this.lastDiagram);
      }
    }
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
   * Records bump-worthy agent activity (spec 2026-07-13 §3/§4.2): slides the
   * idle window, re-arms the expiry alarm at the new effective deadline, and
   * pushes a status envelope so the macro passively learns the fresh deadline
   * (and any non-forwarded activity). Push is best-effort — a missing/closing
   * macro socket must never fail the agent's request.
   *
   * A2 (spec review): a 'suspended' session must NOT slide. Agent retry
   * traffic against a gone macro must not extend a macro-less session — the
   * resume window stays the remaining effective expiry at drop time.
   */
  private async bumpActivity(activity?: StatusActivity): Promise<void> {
    if (!this.session) return;
    if (this.session.state === 'suspended') return;
    this.session.lastActivityMs = Date.now();
    await this.state.storage.put('session', this.session);
    const deadline = effectiveExpiryMs(this.session.issuedAtMs, this.session.lastActivityMs);
    await this.state.storage.setAlarm(deadline);
    this.pushStatus(activity);
  }

  /** Sends {kind:'status'} to the macro socket, if one is live. */
  private pushStatus(activity?: StatusActivity): void {
    if (!this.session || !this.macroSocket) return;
    try {
      this.macroSocket.send(
        statusEnvelope(
          effectiveExpiryMs(this.session.issuedAtMs, this.session.lastActivityMs),
          isAtCap(this.session.issuedAtMs, this.session.lastActivityMs),
          activity,
        ),
      );
    } catch {
      // Best-effort — the socket may be closing; the agent's request must not fail.
    }
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
      return this.handleSessionInfo(url.searchParams.get('bump') === '1');
    }
    if (url.pathname === '/activity' && request.method === 'POST') {
      return this.handleActivity(request);
    }
    if (url.pathname === '/agent-op' && request.method === 'POST') {
      return this.handleAgentOp(request);
    }
    // Per-contentId mint-exclusivity (design §7 decision #2) — called on a
    // SEPARATE DO instance of this same class, addressed by
    // `content:<cloudId>:<contentId>` rather than a token (see session.ts). Not a
    // WebSocket upgrade either.
    if (url.pathname === '/content-claim' && request.method === 'POST') {
      return this.handleContentClaim(request);
    }
    if (url.pathname === '/content-release' && request.method === 'POST') {
      return this.handleContentRelease(request);
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

    // A macro reconnecting after a hibernation wake must re-attach to the
    // existing (persisted) session rather than bootstrap a second one.
    await this.ensureSession();

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
      // Bootstrap the session under a concurrency gate (see bootstrapSession).
      // A false return means a DIFFERENT session already owns this contentId —
      // refuse the upgrade rather than pair a second live socket.
      const proceed = await this.bootstrapSession(token, boundContext);
      if (!proceed) {
        return this.rejectUpgrade('diagram_already_linked');
      }
    } else if (this.session.token !== token) {
      return new Response('Token does not match this session', { status: 403 });
    }

    if (this.session.state === 'closed' || this.session.state === 'expired') {
      return new Response(`Session is ${this.session.state}`, { status: 410 });
    }

    // Second concurrent MACRO connection for this token: reject outright
    // rather than silently taking over the existing pairing (design decision
    // #1: "no silent takeover"). Only applies while a macro socket is
    // genuinely live — a 'suspended' session (the prior macro socket already
    // gone) legitimately re-pairs below via 'reattach'.
    if (peer === 'macro' && this.macroSocket && this.session.state !== 'suspended') {
      return this.rejectUpgrade('already_paired');
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

    // A 'suspended' session reconnecting drives 'reattach' (-> active), not
    // the original bootstrap event — see forwarding.ts's reattachEvent and
    // the file header's ws_drop/suspend/reattach story.
    this.transition(reattachEvent(peer, this.session.state === 'suspended'));
    // Persist the post-transition state so a LATER hibernation wake sees it
    // (ensureSession reloads from storage) — the bootstrap path above already
    // persists on first-create; this covers the reattach-from-suspended case,
    // which is the whole point of this task (suspend/resume must survive a
    // wake either side of the gap).
    await this.state.storage.put('session', this.session);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Establish a brand-new session record for this (token-keyed) DO instance,
   * run entirely inside `blockConcurrencyWhile` so the whole
   * create -> persist -> arm-alarm -> claim-content-lock sequence is one
   * indivisible critical section.
   *
   * Why the gate (A3 review, blocker): the last step —
   * `claimContentLockAtCap()` — is a cross-DO `fetch()`, i.e. NON-storage I/O.
   * Cloudflare's input gate only stays closed across STORAGE ops; awaiting a
   * `fetch()` OPENS it, letting a concurrent duplicate connect for the same
   * token (a client retry — plausible once this hop lengthens bootstrap
   * latency) interleave. Without the gate that duplicate would find
   * `this.session` already set but `macroSocket` still null, pair a real socket,
   * and return 101 — while THIS request, on a 409, rolls the record back to
   * `null`. Result: a live, unreachable, never-reaped macro socket
   * (`webSocketMessage`/`alarm` both early-return on `!this.session`, and the
   * alarm was just deleted) with the content lock owned by a different token —
   * exactly the orphan the A3 amendment exists to prevent. `blockConcurrencyWhile`
   * defers all other event delivery until this completes, and everything from
   * here to `macroSocket` being set in `fetch()` is synchronous, so no
   * duplicate can slip into that window either.
   *
   * The macro connection also UPGRADES the per-contentId content lock from the
   * mint's short claim to the absolute cap (design §7 decision #2 / spec §4.3):
   * a real, authenticated connect is the trusted moment to extend it. See
   * claimContentLockAtCap for the true/false semantics.
   *
   * Returns whether the caller may proceed to pair a socket:
   *   - true  — the record is live and this session holds the lock.
   *   - false — a DIFFERENT session already owns this contentId (409); the
   *             record we created has been rolled back and the caller must
   *             reject the upgrade.
   */
  private async bootstrapSession(token: string, boundContext: BoundContext): Promise<boolean> {
    return this.state.blockConcurrencyWhile(async () => {
      // A concurrent connect for this token may have won the gate first and
      // already bootstrapped. A DO instance is keyed by token (idFromName), so
      // an existing record here is necessarily the same session — proceed and
      // let fetch()'s macroSocket check reject the duplicate as already_paired.
      if (this.session) return true;

      const nowMs = Date.now();
      this.session = {
        token,
        boundContext,
        scope: 'read-page+write-diagram',
        issuedAtMs: nowMs,
        lastActivityMs: nowMs,
        state: 'created',
      };
      // Persist so the session survives a DO hibernation wake — reloaded by
      // ensureSession() on the next request (ISSUE 3 fix).
      await this.state.storage.put('session', this.session);
      // TTL fallback in case the macro connects but the agent never does —
      // §7: "created -> expired (token TTL, agent never joined)". Armed at the
      // effective deadline (idle window from bootstrap; capped) — bumps re-arm it.
      await this.state.storage.setAlarm(
        effectiveExpiryMs(this.session.issuedAtMs, this.session.lastActivityMs),
      );
      // Upgrade the per-contentId content lock from the mint's short claim to
      // the 60-min absolute cap. If a DIFFERENT session already holds this
      // diagram's lock (the mint's claim lapsed and another mint grabbed it in
      // the gap before this macro connected), roll back the record we just
      // created and signal the caller to reject the socket.
      const lockHeld = await this.claimContentLockAtCap();
      if (!lockHeld) {
        this.session = null;
        await this.state.storage.delete('session');
        await this.state.storage.deleteAlarm();
        return false;
      }
      return true;
    });
  }

  /**
   * Cleanly refuses a channel upgrade without taking over / joining the
   * session: accepts a throwaway socket, sends an error envelope, and closes
   * it with an application code. Shared by the "no silent takeover" reject
   * (a second concurrent macro, design decision #1) and the
   * exclusivity-conflict reject (a different session already owns this
   * contentId — see fetch()'s bootstrap path).
   */
  private rejectUpgrade(reason: string, code = 4001): Response {
    const rejectPair = new WebSocketPair();
    const [rejectClient, rejectServer] = [rejectPair[0], rejectPair[1]];
    this.state.acceptWebSocket(rejectServer, ['rejected']);
    try {
      rejectServer.send(errorEnvelope(reason));
      rejectServer.close(code, reason);
    } catch {
      // Best-effort — the connecting client still gets a non-101-follow-on
      // close even if send/close itself throws.
    }
    return new Response(null, { status: 101, webSocket: rejectClient });
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
    if (isExpired(this.session.issuedAtMs, this.session.lastActivityMs, Date.now())) {
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
  private async handleSessionInfo(bump: boolean): Promise<Response> {
    await this.ensureSession();
    const auth = this.validateSession();
    if (!auth.ok) return jsonResponse({ error: auth.code }, auth.status);

    // `?bump=1` marks this poll as bump-worthy agent activity (mcp.ts's
    // read-only ops route here): slide the idle window + push status before
    // reporting the fresh deadline.
    if (bump) await this.bumpActivity();

    const session = this.session as SessionRecord; // validateSession() guarantees non-null here
    return jsonResponse(
      {
        state: session.state,
        boundContext: session.boundContext,
        issuedAtMs: session.issuedAtMs,
        // Sliding-TTL fields — the server-authoritative deadline and the raw
        // lastActivity it derives from, so mcp.ts (Task 6) can rebuild a
        // complete SessionRecord cross-isolate.
        lastActivityMs: session.lastActivityMs,
        expiresAtMs: effectiveExpiryMs(session.issuedAtMs, session.lastActivityMs),
        // Baseline for the relay-side update_diagram guardrail; omitted until
        // the agent has read the diagram at least once.
        lastDiagram: this.lastDiagram ?? undefined,
      },
      200,
    );
  }

  /** `POST /activity` — the non-forwarded-activity ingress (spec §4.2): today
   * mcp.ts reports guardrail rejects here; PR3's host hooks will reuse it.
   * Any report is real agent engagement → bump + status push. */
  private async handleActivity(request: Request): Promise<Response> {
    await this.ensureSession();
    const auth = this.validateSession();
    if (!auth.ok) return jsonResponse({ error: auth.code }, auth.status);
    let body: { type?: unknown; detail?: unknown };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid_body' }, 400);
    }
    const type = body?.type;
    if (
      type !== 'guardrail_rejected' &&
      type !== 'protocol_incompatible' &&
      type !== 'client_identified' &&
      type !== 'agent_request' &&
      type !== 'turn'
    ) {
      return jsonResponse({ error: 'invalid_body' }, 400);
    }
    const detail = typeof body?.detail === 'string' ? body.detail : undefined;
    await this.bumpActivity({ type, ...(detail ? { detail } : {}) });
    return jsonResponse({ ok: true }, 200);
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
    await this.ensureSession();
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

    const session = this.session as SessionRecord; // validateSession() guarantees non-null here

    if (session.state === 'suspended') {
      const resume_deadline = effectiveExpiryMs(session.issuedAtMs, session.lastActivityMs);
      // get_status is the one op that must succeed while suspended — it's
      // the agent's only way to observe "waiting for the macro to
      // reconnect" (design §7 decision #4) instead of erroring on every poll.
      if (op === 'get_status') {
        return jsonResponse({ ok: true, payload: { state: 'suspended', resume_deadline } }, 200);
      }
      // Every other op is a structured, RETRIABLE error — never queued (a
      // queued write could apply a stale edit after the user moved on,
      // which is worse than a clean retry once the macro reattaches).
      return jsonResponse({ error: 'macro_disconnected', resume_deadline }, 409);
    }

    // get_status is answered by the DO in every state — link status is
    // session metadata this object owns, and the macro-side op dispatcher
    // (relayClient) has no get_status case, so forwarding it while live
    // failed with "unsupported op: get_status" (found in the 2026-07-10
    // staging spot check; only the suspended branch above ever worked).
    if (op === 'get_status') {
      return jsonResponse(
        {
          ok: true,
          payload: {
            state: session.state,
            connected: Boolean(this.macroSocket),
            pageId: session.boundContext.pageId,
            contentId: session.boundContext.contentId,
            diagramType: this.lastDiagram?.diagramType,
            expiresInSec: Math.max(
              0,
              Math.round(
                (effectiveExpiryMs(session.issuedAtMs, session.lastActivityMs) - Date.now()) / 1000,
              ),
            ),
          },
        },
        200,
      );
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
    // Keep the diagram snapshot fresh for the relay-side update_diagram
    // guardrail (only on a successful reply — a failed op didn't change state).
    if (result.ok) {
      await this.cacheDiagramFromOp(op, args, result.payload);
    }
    return jsonResponse({ ok: result.ok, payload: result.payload }, 200);
  }

  /**
   * Runtime entry point for every message on either hibernatable socket.
   * Parses -> routes -> forwards verbatim -> updates state, all via the
   * pure helpers in forwarding.ts / sessionToken.ts.
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    await this.ensureSession();
    const from = this.peerForSocket(ws);
    if (!from || !this.session) return;

    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const envelope = parseEnvelope(raw);

    if (envelope.kind === 'invalid') {
      ws.send(errorEnvelope(`invalid message: ${envelope.reason}`));
      return;
    }

    // Explicit disconnect (macro-side Disconnect button, or an explicit
    // agent-side close) — the ONLY path to the terminal 'closed' state
    // (design §7). Distinct from an unexpected close/error (webSocketClose/
    // webSocketError below), which suspends instead of closing outright.
    if (envelope.kind === 'disconnect') {
      await this.closeSession(from);
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

  /**
   * A socket closing/erroring WITHOUT a preceding explicit 'disconnect'
   * envelope is treated as ACCIDENTAL (Fullscreen closed via the browser/X
   * control, a modal-close-triggered inline reload, tab crash, net blip) —
   * suspends the pairing rather than closing it outright (design §7: "was:
   * -> closed terminal"). See closeSession() for the explicit-disconnect
   * counterpart, and the file header for the ws_drop/suspend/reattach story.
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleUnexpectedClose(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleUnexpectedClose(ws);
  }

  private async handleUnexpectedClose(closedSocket: WebSocket): Promise<void> {
    if (!this.session) return; // nothing was ever bootstrapped for this DO
    if (this.session.state === 'closed' || this.session.state === 'expired') return; // terminal — nothing to suspend

    const closedPeer = this.peerForSocket(closedSocket);

    if (closedPeer === 'macro') {
      this.macroSocket = null;
      this.session.state = nextState(this.session.state, 'ws_drop');
      // Keep the record (lastDiagram, the token-TTL alarm) — a suspended
      // session is still resumable by the SAME token until that alarm fires
      // (design: "resume window = remaining token TTL, no extension"). This
      // is the whole point of suspend vs the old full-teardown-on-any-close
      // behavior: an agent connected over HTTP (mcp.ts) stays "linked" (just
      // gets a retriable error on ops) while the macro is momentarily gone.
      await this.state.storage.put('session', this.session);
      return;
    }

    // The `peer=agent` WS socket is largely vestigial in this transport (see
    // file header: agents are HTTP-only via mcp.ts) — its closing doesn't
    // interrupt the macro's own pairing. Just drop the stale reference; no
    // FSM transition, no teardown.
    if (closedPeer === 'agent') {
      this.agentSocket = null;
    }
  }

  /**
   * Explicit, full teardown (design §7 "explicit_disconnect -> closed",
   * terminal) — driven ONLY by a peer's explicit `{kind:'disconnect'}`
   * envelope (webSocketMessage above), never by a bare socket close/error
   * (handleUnexpectedClose above suspends instead). Closes both sockets,
   * releases this diagram's per-contentId mint-exclusivity claim, and wipes
   * storage — mirrors the old unconditional `teardown()` this replaces.
   */
  private async closeSession(from: Peer): Promise<void> {
    if (!this.session) return;
    this.session.state = nextState(this.session.state, 'disconnect');

    const other = this.socketFor(this.otherPeer(from));
    try {
      other?.close(1000, 'peer disconnected');
    } catch {
      // Already closed/closing — nothing more to do.
    }
    const closer = this.socketFor(from);
    try {
      closer?.close(1000, 'disconnected');
    } catch {
      // Already closing — nothing more to do.
    }

    await this.releaseContentLock();

    this.macroSocket = null;
    this.agentSocket = null;
    this.lastDiagram = null;
    await this.state.storage.deleteAlarm();
    // Drop the persisted record too, so a later hibernation wake can't
    // restore a torn-down session (companion to ensureSession — ISSUE 3 fix).
    await this.state.storage.delete('session');
    await this.state.storage.delete('lastDiagram');
  }

  /**
   * TTL enforcement (design §7 "created -> expired (token TTL, agent never
   * joined)"; extended by G-design.md: also the 'suspended' resume window's
   * ttl_expiry — "no extension", the same alarm covers both). Scheduled from
   * `fetch` at session bootstrap and re-armed on every bump (bumpActivity) at
   * the current effective (slid, capped) deadline (spec 2026-07-13 §3/§4.2).
   * Because a bump replaces the alarm, a stale alarm can still fire against a
   * deadline that's since slid forward — so re-check the clock and re-arm
   * instead of expiring.
   */
  async alarm(): Promise<void> {
    // Hydrate first — the alarm normally fires on a hibernated (cold)
    // instance where this.session is null; without this the whole expiry
    // teardown below (socket close, content-lock release, storage wipe)
    // silently no-ops, leaving the per-contentId claim held until its own
    // self-clear TTL (up to an hour once Task 5 stretches it to the cap).
    await this.ensureSession();
    if (!this.session) return;
    if (!isExpired(this.session.issuedAtMs, this.session.lastActivityMs, Date.now())) {
      // Terminal states never come back — a stale in-flight alarm on a warm
      // instance (closeSession keeps this.session set) must not re-arm.
      if (this.session.state === 'closed' || this.session.state === 'expired') return;
      // A bump slid the deadline past this (already-replaced) alarm — re-arm
      // defensively at the current effective deadline instead of expiring.
      await this.state.storage.setAlarm(
        effectiveExpiryMs(this.session.issuedAtMs, this.session.lastActivityMs),
      );
      return;
    }
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
    await this.releaseContentLock();
    this.macroSocket = null;
    this.agentSocket = null;
    this.lastDiagram = null;
    // Drop the persisted record on TTL expiry so a wake can't resurrect it
    // (validateSession's clock check would still reject it, but don't leak).
    await this.state.storage.delete('session');
    await this.state.storage.delete('lastDiagram');
  }
}
