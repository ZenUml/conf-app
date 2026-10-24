// src/composables/agentLink/relayClient.ts
//
// Macro-side WebSocket client for the Live Agent Link relay channel
// (docs/superpowers/specs/2026-07-08-live-agent-link-design.md §4.3-§4.5,
// §5.2). Opens `wsUrl` (already carrying `?token=&peer=macro&cloudId=&pageId=&contentId=` —
// see relayUrl.ts) as the macro's live channel to the relay's
// AgentLinkSession Durable Object. That DO forwards JSON envelopes verbatim
// from the paired agent (see the relay worktree's
// functions/agent-link/forwarding.ts): peer kinds
// `{kind:'op'|'result'|'error'|'ping'|'disconnect', id?, op?, payload?}`;
// the relay can also originate macro-bound `{kind:'status'}` envelopes (never
// peer-sent).
// This client dispatches incoming `op` envelopes to the injected
// AgentLinkBridgeOps and replies with `result` / `error`, keyed by the same
// `id`. `result`/`error` are never expected INBOUND here (those are the
// macro's own outbound reply kinds), so they're ignored if seen; `ping` is
// always ignored (design: an application-level liveness envelope, not
// something either side reacts to).
//
// Reconnect-by-token: Fullscreen is a separate iframe from the small macro
// (see GenericViewer.vue's connectToAgent() comment), so reloading either
// re-mounts this composable fresh. Because the relay's DO is keyed by TOKEN
// (channel.ts: `env.AGENT_LINK.idFromName(token)`), reconnecting with the
// same wsUrl re-attaches to the same session — so an UNEXPECTED close (i.e.
// not our own close()) retries with backoff instead of giving up
// immediately. maxReconnectAttempts / reconnectBackoffMs / clock are all
// injectable so tests don't wait on real timers.

import type { AgentLinkBridgeOps } from './bridgeOps'

export type RelayEnvelopeKind = 'op' | 'result' | 'error' | 'ping' | 'disconnect' | 'status'

export interface RelayEnvelope {
  kind: RelayEnvelopeKind
  id?: string
  op?: string
  payload?: any
  // Relay-originated status fields (spec 2026-07-13 §4.4). Only present on
  // {kind:'status'} envelopes, which the DO pushes down the macro socket
  // itself — the macro never sends these.
  expiresAt?: number
  hitCap?: boolean
  activity?: { type: string; detail?: string }
}

export type RelayConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed'

// Outcome of a single relay-driven `update_diagram` op, passed to
// onEditApplied. Mirrors the shape applyEdit() (useAgentLinkSession.ts)
// already derives from WriteDiagramResult, so the same feed+analytics
// side-effect function can consume either.
export interface RelayEditOutcome {
  ok: boolean
  dsl?: string
  summary?: string
  rendered?: boolean
  reason?: string
}

// Emitted for the composable layer (useAgentLinkSession) to react to —
// notably 'op', the only observable proxy this wire protocol offers for
// "the agent has paired" (the protocol has no dedicated pairing envelope;
// see forwarding.ts's Envelope union), and 'close'/'reconnect_failed' for
// surfacing connection loss.
export type RelayStateEvent =
  | { type: 'open'; reconnectAttempt?: number }
  | {
      type: 'close'
      code?: number
      wasClean?: boolean
      reconnectAttempt?: number
      unexpected?: boolean
    }
  | { type: 'error'; message?: string; reconnectAttempt?: number; unexpected?: boolean }
  | { type: 'reconnecting'; attempt: number }
  | { type: 'reconnect_failed'; attempt?: number }
  // `receivedAt` is stamped the instant handleOp() begins (i.e. as close to
  // the wire as this module gets), so the composable can measure perceived
  // latency — op received → "AI thinking" shown — against a transport-owned
  // timestamp rather than one taken after Vue reactivity has already run
  // (charter §6 Track F, agent_link_first_feedback.ms_since_op_received).
  | { type: 'op'; op?: string; receivedAt?: number }
  // Relay-originated status bus (spec 2026-07-13 §4.4). Surfaced verbatim from
  // a {kind:'status'} envelope the relay's DO pushes down this socket (never a
  // peer's op): the fresh authoritative sliding-TTL deadline (`expiresAt`),
  // whether the session has hit its lifetime cap (`hitCap`), and any
  // non-forwarded activity the composable (useAgentLinkSession) renders.
  | {
      type: 'status'
      expiresAt?: number
      hitCap?: boolean
      activity?: { type: string; detail?: string }
    }

// Mirrors useAgentLinkSession.ts's AgentLinkClock injection pattern so the
// reconnect backoff is testable without real timers.
export interface RelayClock {
  setTimeout?: (handler: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
  // Injectable wall clock for the op-received timestamp (Track F perceived
  // latency). Defaults to Date.now; tests pass a deterministic one.
  now?: () => number
}

export interface CreateRelayClientOptions {
  wsUrl: string
  bridge: AgentLinkBridgeOps
  onStateEvent?: (event: RelayStateEvent) => void
  // Fires after a `update_diagram` op's bridge.writeDiagram() PERSISTS
  // successfully (design §4.4 adapted — persist-then-render, not
  // render-then-persist: an edit that failed to save must not visibly
  // diverge from what's actually stored). This is the ONLY place the new
  // DSL becomes observable outside the persistence call — bridge.writeDiagram
  // only writes to Confluence custom-content; nothing about that write makes
  // the currently-mounted Vue app's diagram re-render (that was the bug).
  // The caller (useAgentLinkSession -> GenericViewer.vue) uses this to
  // mirror the in-app code editor's own live-update mechanism
  // (store.dispatch(getStoreUpdateAction(diagramType), dsl) — see
  // Editor.vue's onEditorCodeChange) so the diagram redraws WITHOUT reload.
  onDiagramUpdated?: (dsl: string) => void
  // Fires once per `update_diagram` op, after the write settles (resolved OR
  // rejected) — success or failure. This is the ONLY place a relay-driven
  // agent edit becomes observable to the Fullscreen activity feed and to
  // Mixpanel: unlike the manual applyEdit() seam, handleOp() calls
  // opts.bridge.writeDiagram() directly, so without this callback a real
  // agent edit silently never reaches activityFeed / agent_link_edit_applied
  // / agent_link_edit_failed (the gap this callback closes). The caller
  // (useAgentLinkSession) wires this to the SAME side-effect function
  // applyEdit() itself uses, so there is one source of truth for
  // feed+analytics regardless of which seam produced the edit.
  onEditApplied?: (outcome: RelayEditOutcome) => void
  // Fires once per `read_page` op, after opts.bridge.readPage() resolves.
  // Registered in catalog.ts (agent_link_page_read) since the design doc's
  // §10 table, but had NO firing site until this callback existed — handleOp()
  // called bridge.readPage() directly and returned the result over the wire,
  // so the event was dead (audited 2026-07-09). Same shape as onEditApplied:
  // the caller (useAgentLinkSession) is the one place with macro_type/surface
  // context to fire trackAnalyticsEvent, so this module stays analytics-free
  // and only signals "it happened".
  onPageRead?: () => void
  // --- Track U discovery ops (design §S3/S4/S5) ------------------------------
  // Same "transport signals it happened, composable does feed+analytics"
  // pattern as onPageRead/onEditApplied. Fired once per matching op, AFTER the
  // bridge resolves. `title`/`byContentId` (read), `hits`/`query` (search),
  // `scope`/`hits` (list) carry only what the feed row + Mixpanel event need —
  // no raw query is passed to analytics downstream (privacy: query_len only).
  onDiagramRead?: (info: { title?: string; byContentId: boolean }) => void
  onSearchPerformed?: (info: { query: string; hits: number }) => void
  onListPerformed?: (info: { scope: 'page' | 'space' | 'site'; hits: number }) => void
  // Injectable so tests pass a mock instead of a real browser WebSocket.
  WebSocketImpl?: new (url: string) => WebSocket
  maxReconnectAttempts?: number
  reconnectBackoffMs?: (attempt: number) => number
  clock?: RelayClock
}

export interface RelayClient {
  send(envelope: RelayEnvelope): void
  // Abandons the connection WITHOUT telling the server anything — used when
  // discarding a stale/replaced client (e.g. startConnect() tearing down a
  // prior relayClient before opening a fresh one). Does NOT send a
  // {kind:'disconnect'} envelope, so if this DID have a live paired session
  // the relay's DO sees a bare close and SUSPENDS it (design §7's
  // accidental-disconnect path), not closes it. Use disconnect() below for a
  // genuine user-driven Disconnect.
  close(): void
  // Explicit disconnect (design §7 "explicit_disconnect -> closed"): sends a
  // {kind:'disconnect'} envelope so the relay's DO can tell this apart from
  // an unexpected drop (which suspends, not closes) BEFORE tearing down the
  // socket. This is what a user clicking "Disconnect" must call.
  disconnect(): void
  getState(): RelayConnectionState
}

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5

// 500ms, 1s, 2s, 4s, 8s… capped at 10s.
function defaultReconnectBackoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 10000)
}

export function createRelayClient(opts: CreateRelayClientOptions): RelayClient {
  const WebSocketImpl = opts.WebSocketImpl ?? (globalThis as any).WebSocket
  const maxReconnectAttempts = opts.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS
  const backoffMs = opts.reconnectBackoffMs ?? defaultReconnectBackoffMs
  const scheduleTimeout =
    opts.clock?.setTimeout ?? ((handler: () => void, ms: number) => setTimeout(handler, ms))
  const cancelTimeout =
    opts.clock?.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const nowFn = opts.clock?.now ?? (() => Date.now())

  let ws: WebSocket | null = null
  let state: RelayConnectionState = 'connecting'
  let closedByCaller = false
  let reconnectAttempt = 0
  let reconnectTimer: unknown = null

  function emit(event: RelayStateEvent): void {
    opts.onStateEvent?.(event)
  }

  function send(envelope: RelayEnvelope): void {
    if (!ws || state !== 'open') return
    ws.send(JSON.stringify(envelope))
  }

  async function handleOp(envelope: RelayEnvelope): Promise<void> {
    const { id, op, payload } = envelope
    emit({ type: 'op', op, receivedAt: nowFn() })
    try {
      let result: unknown
      switch (op) {
        case 'read_page':
          result = await opts.bridge.readPage()
          opts.onPageRead?.()
          break
        case 'read_diagram': {
          // S5: an optional `contentId` reads a discovered hit; omitted reads
          // the bound diagram (bridgeOps defaults it). byContentId drives the
          // agent_link_diagram_read `by_content_id` property + feed copy.
          const contentId = typeof payload?.contentId === 'string' ? payload.contentId : undefined
          const readResult = await opts.bridge.readDiagram(contentId)
          result = readResult
          opts.onDiagramRead?.({
            title: (readResult as { title?: string } | undefined)?.title,
            byContentId: contentId !== undefined,
          })
          break
        }
        case 'search_diagrams': {
          // S3: candidate rows; the agent re-ranks. `query` is required by the
          // relay-side arg validation (mcpTools), so treat a missing one as ''.
          const query = typeof payload?.query === 'string' ? payload.query : ''
          const rows = await opts.bridge.searchDiagrams({
            query,
            types: Array.isArray(payload?.types) ? payload.types : undefined,
            spaceKey: typeof payload?.spaceKey === 'string' ? payload.spaceKey : undefined,
            limit: typeof payload?.limit === 'number' ? payload.limit : undefined,
          })
          result = rows
          opts.onSearchPerformed?.({ query, hits: Array.isArray(rows) ? rows.length : 0 })
          break
        }
        case 'list_diagrams': {
          // S4: recency-ordered browse. scope classifies the feed/analytics row:
          // a pageId is the narrowest, then spaceKey, else the whole site.
          const spaceKey = typeof payload?.spaceKey === 'string' ? payload.spaceKey : undefined
          const pageId = typeof payload?.pageId === 'string' ? payload.pageId : undefined
          const rows = await opts.bridge.listDiagrams({
            spaceKey,
            pageId,
            types: Array.isArray(payload?.types) ? payload.types : undefined,
            limit: typeof payload?.limit === 'number' ? payload.limit : undefined,
          })
          result = rows
          const scope = pageId ? 'page' : spaceKey ? 'space' : 'site'
          opts.onListPerformed?.({ scope, hits: Array.isArray(rows) ? rows.length : 0 })
          break
        }
        case 'update_diagram': {
          const dsl = typeof payload?.dsl === 'string' ? payload.dsl : undefined
          const summary = payload?.summary
          try {
            const writeResult = await opts.bridge.writeDiagram(dsl, summary)
            const ok = Boolean((writeResult as any)?.ok)
            // Only fire the live-render callback once the write actually
            // persisted — see onDiagramUpdated's doc comment above.
            if (ok && dsl !== undefined) {
              opts.onDiagramUpdated?.(dsl)
            }
            opts.onEditApplied?.({
              ok,
              dsl,
              summary,
              rendered: (writeResult as any)?.rendered,
              reason: (writeResult as any)?.reason,
            })
            result = writeResult
          } catch (e: any) {
            // A rejected write is still a failed edit from the feed/analytics
            // point of view — report it, then rethrow so the outer catch's
            // existing `error` envelope reply behavior is unchanged.
            opts.onEditApplied?.({ ok: false, dsl, summary, reason: e?.message ?? String(e) })
            throw e
          }
          break
        }
        default:
          throw new Error(`unsupported op: ${op}`)
      }
      send({ kind: 'result', id, payload: result })
    } catch (e: any) {
      send({ kind: 'error', id, payload: { message: e?.message ?? String(e) } })
    }
  }

  function handleMessage(raw: string): void {
    let envelope: RelayEnvelope
    try {
      envelope = JSON.parse(raw)
    } catch {
      return // malformed — nothing sensible to reply with, drop silently
    }
    if (!envelope || typeof envelope !== 'object') return
    if (envelope.kind === 'ping') return // liveness only — never acted on
    if (envelope.kind === 'status') {
      // Relay-originated status bus (spec 2026-07-13 §4.4): the DO's own
      // message, not a peer's — carries the fresh authoritative deadline and
      // any non-forwarded activity. Surface as a state event; never an op.
      emit({
        type: 'status',
        expiresAt: envelope.expiresAt,
        hitCap: envelope.hitCap,
        activity: envelope.activity,
      })
      return
    }
    if (envelope.kind === 'op') {
      void handleOp(envelope)
      return
    }
    // 'result' / 'error' are the macro's OWN outbound reply kinds — nothing
    // ever forwards those back to the macro (routeMessage only ever sends
    // agent->macro 'op'), so seeing one here would mean a protocol bug on
    // the relay side. Ignored rather than thrown, matching this module's
    // "never let a malformed/unexpected message crash the channel" stance.
  }

  function scheduleReconnect(): void {
    if (closedByCaller) return
    if (reconnectAttempt >= maxReconnectAttempts) {
      emit({ type: 'reconnect_failed', attempt: reconnectAttempt })
      return
    }
    reconnectAttempt += 1
    state = 'reconnecting'
    emit({ type: 'reconnecting', attempt: reconnectAttempt })
    reconnectTimer = scheduleTimeout(() => connect(), backoffMs(reconnectAttempt))
  }

  function connect(): void {
    state = 'connecting'
    const socket = new WebSocketImpl(opts.wsUrl)
    ws = socket

    socket.onopen = () => {
      const successfulReconnectAttempt = reconnectAttempt
      reconnectAttempt = 0
      state = 'open'
      emit(
        successfulReconnectAttempt > 0
          ? { type: 'open', reconnectAttempt: successfulReconnectAttempt }
          : { type: 'open' }
      )
    }
    socket.onmessage = (evt: MessageEvent) => {
      const raw = typeof evt.data === 'string' ? evt.data : String(evt.data)
      handleMessage(raw)
    }
    socket.onerror = (evt: any) => {
      emit({
        type: 'error',
        message: evt?.message,
        reconnectAttempt,
        unexpected: !closedByCaller,
      })
    }
    socket.onclose = (evt: any) => {
      state = 'closed'
      emit({
        type: 'close',
        code: evt?.code,
        wasClean: evt?.wasClean,
        reconnectAttempt,
        unexpected: !closedByCaller,
      })
      if (!closedByCaller) scheduleReconnect()
    }
  }

  connect()

  return {
    send,
    close(): void {
      closedByCaller = true
      if (reconnectTimer != null) cancelTimeout(reconnectTimer)
      state = 'closed'
      try {
        ws?.close()
      } catch {
        // already closed/closing — nothing more to do.
      }
    },
    disconnect(): void {
      // Best-effort: if the socket isn't currently 'open' (connecting/
      // reconnecting), send() is a no-op — there's nothing live to notify,
      // and closing below still aborts any in-flight connect attempt.
      try {
        send({ kind: 'disconnect' })
      } catch {
        // Socket already gone — fall through to close() regardless.
      }
      closedByCaller = true
      if (reconnectTimer != null) cancelTimeout(reconnectTimer)
      state = 'closed'
      try {
        ws?.close()
      } catch {
        // already closed/closing — nothing more to do.
      }
    },
    getState: () => state,
  }
}
