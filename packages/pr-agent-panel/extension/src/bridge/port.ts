/**
 * Content-side wrapper around the `pr-panel` runtime port. MV3 service
 * workers stop when idle and every restart disconnects open ports, so this
 * reconnects with backoff and replays `hello` (and whatever `onReconnect`
 * re-sends, e.g. `register`).
 */
import { browser } from 'wxt/browser'
import type { ExtensionFrame, HubFrame } from '@zenuml/pr-panel-shared'
import { PORT_NAME, parsePortEvent, type HubStatusMessage, type PortRequest } from './messages'

type RuntimePort = ReturnType<typeof browser.runtime.connect>

export interface PanelPortOptions {
  /** Repo whose cached reviews the broker should replay on (re)connect. */
  getRepoKey?: () => string | undefined
  /** Called after every (re)connect, after `hello`. */
  onReconnect?: (port: PanelPort) => void
  connect?: () => RuntimePort
}

const BACKOFF_MS = [100, 250, 500, 1000, 2000, 5000]

/** One id per page load; tells this tab apart from others at the Hub. */
export const documentId: string = crypto.randomUUID()

export class PanelPort {
  private port: RuntimePort | null = null
  private closed = false
  private failures = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private frameListeners = new Set<(f: HubFrame) => void>()
  private statusListeners = new Set<(s: HubStatusMessage) => void>()

  constructor(private readonly options: PanelPortOptions = {}) {}

  connect(): void {
    if (this.closed || this.port) return
    let port: RuntimePort
    try {
      port = (this.options.connect ?? (() => browser.runtime.connect({ name: PORT_NAME })))()
    } catch {
      // Extension context invalidated (the extension was reloaded): stop quietly.
      this.closed = true
      return
    }
    this.port = port
    port.onMessage.addListener((raw: unknown) => {
      this.failures = 0
      const ev = parsePortEvent(raw)
      if (!ev) return
      if (ev.kind === 'status') this.statusListeners.forEach((l) => l(ev.status))
      else this.frameListeners.forEach((l) => l(ev.frame))
    })
    port.onDisconnect.addListener(() => {
      this.port = null
      if (this.closed) return
      const delay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)] ?? 5000
      this.failures++
      this.retryTimer = setTimeout(() => this.connect(), delay)
    })
    this.post({ kind: 'hello', documentId, repoKey: this.options.getRepoKey?.() })
    this.options.onReconnect?.(this)
  }

  post(message: PortRequest): boolean {
    if (!this.port) return false
    try {
      this.port.postMessage(message)
      return true
    } catch {
      return false
    }
  }

  send(frame: ExtensionFrame): boolean {
    return this.post({ kind: 'frame', frame })
  }

  onFrame(listener: (f: HubFrame) => void): () => void {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onStatus(listener: (s: HubStatusMessage) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  disconnect(): void {
    this.closed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    try {
      this.port?.disconnect()
    } catch {
      // ignore
    }
    this.port = null
  }
}

/** Envelope helper for ext → hub frames built in the page. */
export function envelope<T extends { type: string }>(body: T): T & { v: 1; id: string; ts: number } {
  return { v: 1, id: crypto.randomUUID(), ts: Date.now(), ...body }
}
