// src/composables/agentLink/relayClient.ts
//
// Macro-side WebSocket client for the Live Agent Link relay channel
// (docs/superpowers/specs/2026-07-08-live-agent-link-design.md §4.3-§4.5,
// §5.2). Opens `wsUrl` (already carrying `?token=&peer=macro&cloudId=&pageId=&contentId=` —
// see relayUrl.ts) as the macro's live channel to the relay's
// AgentLinkSession Durable Object. That DO forwards JSON envelopes verbatim
// from the paired agent (see the relay worktree's
// functions/agent-link/forwarding.ts): `{kind:'op'|'result'|'error'|'ping', id?, op?, payload?}`.
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

export type RelayEnvelopeKind = 'op' | 'result' | 'error' | 'ping'

export interface RelayEnvelope {
  kind: RelayEnvelopeKind
  id?: string
  op?: string
  payload?: any
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
  | { type: 'open' }
  | { type: 'close'; code?: number; wasClean?: boolean }
  | { type: 'error'; message?: string }
  | { type: 'reconnecting'; attempt: number }
  | { type: 'reconnect_failed' }
  | { type: 'op'; op?: string }

// Mirrors useAgentLinkSession.ts's AgentLinkClock injection pattern so the
// reconnect backoff is testable without real timers.
export interface RelayClock {
  setTimeout?: (handler: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
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
  // Injectable so tests pass a mock instead of a real browser WebSocket.
  WebSocketImpl?: new (url: string) => WebSocket
  maxReconnectAttempts?: number
  reconnectBackoffMs?: (attempt: number) => number
  clock?: RelayClock
}

export interface RelayClient {
  send(envelope: RelayEnvelope): void
  close(): void
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
    emit({ type: 'op', op })
    try {
      let result: unknown
      switch (op) {
        case 'read_page':
          result = await opts.bridge.readPage()
          opts.onPageRead?.()
          break
        case 'read_diagram':
          result = await opts.bridge.readDiagram()
          break
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
      emit({ type: 'reconnect_failed' })
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
      reconnectAttempt = 0
      state = 'open'
      emit({ type: 'open' })
    }
    socket.onmessage = (evt: MessageEvent) => {
      const raw = typeof evt.data === 'string' ? evt.data : String(evt.data)
      handleMessage(raw)
    }
    socket.onerror = (evt: any) => {
      emit({ type: 'error', message: evt?.message })
    }
    socket.onclose = (evt: any) => {
      state = 'closed'
      emit({ type: 'close', code: evt?.code, wasClean: evt?.wasClean })
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
    getState: () => state,
  }
}
