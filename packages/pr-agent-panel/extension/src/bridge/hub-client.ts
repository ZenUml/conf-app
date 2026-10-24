/**
 * Service-worker side connection to the local Hub. Adapted from TemPad Dev's
 * hub client (MIT, see THIRD_PARTY_NOTICES.md): probe a short list of loopback
 * ports with an HTTP GET, accept only our Hub's probe JSON, then open a
 * WebSocket with a fixed subprotocol and handshake with `hello` → `registered`.
 *
 * No DOM and no globals: `fetch`, `WebSocket` and the last-port store are
 * injected so the whole state machine runs under fake timers in tests.
 */
import {
  BRIDGE_SUBPROTOCOL,
  HUB_HANDSHAKE_TIMEOUT_MS,
  HUB_PROBE_SERVICE,
  HubProbeResponseSchema,
  KEEPALIVE_INTERVAL_MS,
  PORT_CANDIDATES,
  PORT_PROBE_TIMEOUT_MS,
  PROTOCOL_VERSION,
  RECONNECT_DELAY_MS,
  parseHubFrame,
  type ExtensionFrame,
  type HubFrame,
} from '@zenuml/pr-panel-shared'

export type HubDisconnectReason = 'not_running' | 'closed' | 'protocol_mismatch' | 'origin_rejected' | 'another_connection'

export type HubConnectionState = 'disabled' | 'probing' | 'connecting' | 'connected' | 'not_running'

export interface HubStatus {
  state: HubConnectionState
  port?: number
  hubVersion?: string
  /** Why the last connection ended or failed; absent while connected. */
  reason?: HubDisconnectReason
}

/** The subset of the DOM WebSocket the client uses. */
export interface WebSocketLike {
  readonly readyState: number
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}
export type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocketLike

type FetchLike = (input: string, init?: { cache?: RequestCache; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

export interface HubClientOptions {
  fetch: FetchLike
  WebSocket: WebSocketCtor
  extVersion: string
  getLastPort?: () => number | null | undefined | Promise<number | null | undefined>
  setLastPort?: (port: number) => void | Promise<void>
  now?: () => number
  newId?: () => string
}

export interface HubClientEvents {
  status: HubStatus
  frame: HubFrame
  connected: { port: number; hubVersion: string; connectMs: number }
  disconnected: { reason: HubDisconnectReason; wasConnected: boolean }
}
type Listener<K extends keyof HubClientEvents> = (payload: HubClientEvents[K]) => void

const OPEN = 1

/** Last good port first (only when it is one of ours), then the fixed list in order. */
export function getPortCandidates(lastPort?: number | null): number[] {
  const ports: number[] = [...PORT_CANDIDATES]
  if (lastPort != null && ports.includes(lastPort)) return [lastPort, ...ports.filter((p) => p !== lastPort)]
  return ports
}

export class HubClient {
  private readonly opts: Required<Omit<HubClientOptions, 'getLastPort' | 'setLastPort'>> &
    Pick<HubClientOptions, 'getLastPort' | 'setLastPort'>
  private listeners = new Map<keyof HubClientEvents, Set<(payload: never) => void>>()
  private enabled = false
  private ws: WebSocketLike | null = null
  private registered = false
  private helloId: string | null = null
  private failReason: HubDisconnectReason | null = null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private _status: HubStatus = { state: 'disabled' }

  constructor(options: HubClientOptions) {
    this.opts = {
      now: () => Date.now(),
      newId: () => crypto.randomUUID(),
      ...options,
    }
  }

  get status(): HubStatus {
    return this._status
  }

  get isConnected(): boolean {
    return this.registered && this.ws?.readyState === OPEN
  }

  on<K extends keyof HubClientEvents>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(listener as (payload: never) => void)
    return () => {
      set.delete(listener as (payload: never) => void)
    }
  }

  start(): void {
    if (this.enabled) return
    this.enabled = true
    void this.connect()
  }

  stop(): void {
    this.enabled = false
    this.attempt++
    this.clearReconnect()
    this.teardown(1000, 'disabled')
    this.setStatus({ state: 'disabled' })
  }

  /** Probe again now instead of waiting for the reconnect timer (e.g. right after permission is granted). */
  retryNow(): void {
    if (!this.enabled || this.ws) return
    this.clearReconnect()
    void this.connect()
  }

  /** Sends a frame when connected; returns false otherwise (the caller decides whether to queue). */
  send(frame: ExtensionFrame): boolean {
    if (!this.isConnected || !this.ws) return false
    this.ws.send(JSON.stringify(frame))
    return true
  }

  private emit<K extends keyof HubClientEvents>(event: K, payload: HubClientEvents[K]): void {
    for (const l of (this.listeners.get(event) ?? []) as Set<Listener<K>>) {
      try {
        l(payload)
      } catch {
        // A listener's failure must not break the connection loop.
      }
    }
  }

  private setStatus(status: HubStatus): void {
    this._status = status
    this.emit('status', status)
  }

  private async probe(port: number): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PORT_PROBE_TIMEOUT_MS)
    try {
      const res = await this.opts.fetch(`http://127.0.0.1:${port}/`, { cache: 'no-store', signal: controller.signal })
      if (!res.ok) return false
      const parsed = HubProbeResponseSchema.safeParse(await res.json())
      return parsed.success && parsed.data.service === HUB_PROBE_SERVICE
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  private async connect(): Promise<void> {
    const attempt = ++this.attempt
    const startedAt = this.opts.now()
    this.setStatus({ state: 'probing' })
    let lastPort: number | null | undefined
    try {
      lastPort = await this.opts.getLastPort?.()
    } catch {
      lastPort = null
    }
    let found: number | null = null
    for (const port of getPortCandidates(lastPort)) {
      if (!this.enabled || attempt !== this.attempt) return
      if (await this.probe(port)) {
        found = port
        break
      }
    }
    if (!this.enabled || attempt !== this.attempt) return
    if (found == null) {
      this.setStatus({ state: 'not_running', reason: 'not_running' })
      this.emit('disconnected', { reason: 'not_running', wasConnected: false })
      this.scheduleReconnect()
      return
    }
    this.open(found, startedAt)
  }

  private open(port: number, startedAt: number): void {
    this.setStatus({ state: 'connecting', port })
    this.registered = false
    this.failReason = null
    let ws: WebSocketLike
    try {
      ws = new this.opts.WebSocket(`ws://127.0.0.1:${port}/`, BRIDGE_SUBPROTOCOL)
    } catch {
      this.setStatus({ state: 'not_running', reason: 'closed' })
      this.emit('disconnected', { reason: 'closed', wasConnected: false })
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      if (this.ws !== ws) return
      this.helloId = this.opts.newId()
      ws.send(
        JSON.stringify({
          v: 1,
          id: this.helloId,
          ts: this.opts.now(),
          type: 'hello',
          extVersion: this.opts.extVersion,
          protocolVersion: PROTOCOL_VERSION,
        }),
      )
      this.handshakeTimer = setTimeout(() => {
        if (this.ws !== ws || this.registered) return
        this.failReason = 'closed'
        ws.close(4000, 'handshake timeout')
        this.handleClose(ws, port)
      }, HUB_HANDSHAKE_TIMEOUT_MS)
    }

    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return
      const frame = parseHubFrame(ev.data)
      if (!frame) return
      if (!this.registered) {
        if (frame.type === 'error' && frame.code === 'protocol_mismatch') {
          this.failReason = 'protocol_mismatch'
          ws.close(4001, 'protocol mismatch')
          this.handleClose(ws, port)
          return
        }
        if (frame.type !== 'registered' || frame.inReplyTo !== this.helloId) return
        if (frame.protocolVersion !== PROTOCOL_VERSION) {
          this.failReason = 'protocol_mismatch'
          ws.close(4001, 'protocol mismatch')
          this.handleClose(ws, port)
          return
        }
        this.registered = true
        this.clearHandshake()
        this.keepaliveTimer = setInterval(() => {
          if (this.ws === ws && ws.readyState === OPEN) {
            ws.send(JSON.stringify({ v: 1, id: this.opts.newId(), ts: this.opts.now(), type: 'ping' }))
          }
        }, KEEPALIVE_INTERVAL_MS)
        void Promise.resolve(this.opts.setLastPort?.(port)).catch(() => {})
        this.setStatus({ state: 'connected', port, hubVersion: frame.hubVersion })
        this.emit('connected', { port, hubVersion: frame.hubVersion, connectMs: Math.max(0, this.opts.now() - startedAt) })
        return
      }
      if (frame.type === 'pong') return
      this.emit('frame', frame)
    }

    ws.onerror = () => {
      // `close` follows `error`; the reason is decided there.
    }
    ws.onclose = () => this.handleClose(ws, port)
  }

  private handleClose(ws: WebSocketLike, port: number): void {
    if (this.ws !== ws) return
    const wasConnected = this.registered
    const reason: HubDisconnectReason = this.failReason ?? 'closed'
    this.teardown()
    if (!this.enabled) return
    this.setStatus({ state: 'not_running', port, reason })
    this.emit('disconnected', { reason, wasConnected })
    this.scheduleReconnect()
  }

  private teardown(code?: number, why?: string): void {
    this.clearHandshake()
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer)
    this.keepaliveTimer = null
    const ws = this.ws
    this.ws = null
    this.registered = false
    this.helloId = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
      if (code != null) {
        try {
          ws.close(code, why)
        } catch {
          // already closed
        }
      }
    }
  }

  private clearHandshake(): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    this.handshakeTimer = null
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private scheduleReconnect(): void {
    this.clearReconnect()
    if (!this.enabled) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.enabled && !this.ws) void this.connect()
    }, RECONNECT_DELAY_MS)
  }
}
