/**
 * McpBroker: the service worker's single owner of the Hub connection. Pages
 * and the options page talk to it over `pr-panel` runtime ports; it forwards
 * their frames to the Hub, fans Hub frames out to every port, keeps the last
 * `state` and the last `reviews` per repo to replay to a newly connected
 * port, and re-registers every open tab after a Hub reconnect.
 */
import {
  repoKeyOf,
  type ExtensionFrame,
  type HubFrame,
} from '@zenuml/pr-panel-shared'
import { buildTelemetryFrame, type TelemetryFrameT } from '../analytics/telemetry'
import type { HubClient, HubStatus } from './hub-client'
import { parsePortRequest, type HubStatusMessage, type PortEvent, type PortRequest } from './messages'
import type { McpAccess } from '../state/prefs'
import type { ReviewTabs } from './review-tabs'

type RegisterFrame = Extract<ExtensionFrame, { type: 'register' }>
type ListReviewsFrame = Extract<ExtensionFrame, { type: 'listReviews' }>
type StateFrame = Extract<HubFrame, { type: 'state' }>
type ReviewsFrame = Extract<HubFrame, { type: 'reviews' }>
type GroupFrame = Extract<HubFrame, { type: 'group' }>

/** The subset of `runtime.Port` the broker uses. */
export interface BrokerPort {
  sender?: { tab?: { id?: number; active?: boolean } }
  postMessage(message: unknown): void
  onMessage: { addListener(cb: (message: unknown) => void): void }
  onDisconnect: { addListener(cb: () => void): void }
}

export interface BrokerDeps {
  client: Pick<HubClient, 'start' | 'stop' | 'send' | 'retryNow' | 'on' | 'status'>
  hasHostPermission: () => Promise<boolean>
  getMcpAccess: () => Promise<McpAccess>
  setMcpAccess: (value: McpAccess) => Promise<void>
  openOptions: () => Promise<void> | void
  reviewTabs?: ReviewTabs
  loadSavedGroup?: () => Promise<GroupFrame | null>
  saveGroup?: (group: GroupFrame) => Promise<void>
}

interface PortEntry {
  documentId?: string
  repoKey?: string
  register?: RegisterFrame
  listReviews?: ListReviewsFrame
}

const MAX_PENDING_TELEMETRY = 20

export class McpBroker {
  private ports = new Map<BrokerPort, PortEntry>()
  private lastState: StateFrame | null = null
  private lastReviews = new Map<string, ReviewsFrame>()
  private lastGroup: GroupFrame | null = null
  private preparingRequestId: string | null = null
  private pendingTelemetry: TelemetryFrameT[] = []
  private status: HubStatusMessage = { state: 'disabled' }
  private disconnectReported = false

  constructor(private readonly deps: BrokerDeps) {
    void deps.loadSavedGroup?.().then((saved) => {
      if (saved && !this.lastGroup) {
        this.lastGroup = saved
        this.broadcast({ kind: 'frame', frame: saved })
      }
    }).catch(() => undefined)
    deps.client.on('status', (s) => this.onClientStatus(s))
    deps.client.on('frame', (f) => this.onHubFrame(f))
    deps.client.on('connected', ({ connectMs }) => {
      this.disconnectReported = false
      for (const entry of this.ports.values()) {
        if (entry.register) this.deps.client.send(entry.register)
        if (entry.listReviews) this.deps.client.send(entry.listReviews)
      }
      const pending = this.pendingTelemetry.splice(0)
      for (const frame of pending) this.deps.client.send(frame)
      this.sendTelemetry(buildTelemetryFrame('pr_panel_hub_connected', { connect_ms: Math.round(connectMs) }))
    })
    deps.client.on('disconnected', ({ reason }) => {
      this.lastState = null
      if (this.disconnectReported) return
      this.disconnectReported = true
      // The Hub is the only telemetry sink, so this waits for the next connection.
      this.sendTelemetry(buildTelemetryFrame('pr_panel_hub_disconnected', { hub_disconnect_reason: reason }))
    })
  }

  /** Reads MCP access + permission and starts or stops the Hub client to match. */
  async applyAccess(): Promise<void> {
    const access = await this.deps.getMcpAccess()
    if (access !== 'enabled') {
      this.deps.client.stop()
      this.setStatus({ state: 'disabled' })
      return
    }
    if (!(await this.deps.hasHostPermission())) {
      this.deps.client.stop()
      this.setStatus({ state: 'disabled', needsPermission: true })
      return
    }
    this.deps.client.start()
  }

  addPort(port: BrokerPort): void {
    const entry: PortEntry = {}
    this.ports.set(port, entry)
    port.onMessage.addListener((raw) => {
      const req = parsePortRequest(raw)
      if (req) void this.handle(port, entry, req)
    })
    port.onDisconnect.addListener(() => {
      // A closed tab or a navigation away: the page cannot be trusted to say goodbye.
      if (entry.register) {
        this.deps.client.send({ v: 1, id: crypto.randomUUID(), ts: Date.now(), type: 'unregister', documentId: entry.register.documentId })
      }
      this.ports.delete(port)
    })
  }

  private async handle(port: BrokerPort, entry: PortEntry, req: PortRequest): Promise<void> {
    switch (req.kind) {
      case 'hello': {
        entry.documentId = req.documentId
        entry.repoKey = req.repoKey
        this.post(port, { kind: 'status', status: this.status })
        if (this.lastState) this.post(port, { kind: 'frame', frame: this.lastState })
        const reviews = req.repoKey ? this.lastReviews.get(req.repoKey) : undefined
        if (reviews) this.post(port, { kind: 'frame', frame: reviews })
        if (this.lastGroup) this.post(port, { kind: 'frame', frame: this.lastGroup })
        return
      }
      case 'frame':
        this.forward(entry, req.frame)
        if (req.frame.type === 'register' && port.sender?.tab?.active) {
          this.deps.client.send({ v: 1, id: crypto.randomUUID(), ts: Date.now(), type: 'activate', documentId: req.frame.documentId })
        }
        return
      case 'setMcpAccess':
        if (req.value === 'enabled' && !(await this.deps.hasHostPermission())) {
          // Only a user gesture on an extension page can grant the permission.
          await this.deps.openOptions()
          return
        }
        await this.deps.setMcpAccess(req.value)
        await this.applyAccess()
        return
      case 'reconnect':
        await this.applyAccess()
        this.deps.client.retryNow()
        return
      case 'openOptions':
        await this.deps.openOptions()
        return
      case 'continueGroup': {
        if (!this.lastGroup?.group || !this.deps.reviewTabs) return
        await this.deps.reviewTabs.continue(this.lastGroup.group)
        const remaining = this.lastGroup.group.items.filter((item) => item.outcome === 'pending').length
        this.sendTelemetry(buildTelemetryFrame('pr_panel_group_resumed', { remaining_pr_count: remaining }))
        return
      }
    }
  }

  private forward(entry: PortEntry, frame: ExtensionFrame): void {
    switch (frame.type) {
      case 'hello':
      case 'ping':
        return // the broker owns the handshake and keepalive
      case 'register':
        entry.register = frame
        entry.documentId = frame.documentId
        entry.repoKey = repoKeyOf(frame.pr)
        break
      case 'unregister':
        if (entry.register?.documentId === frame.documentId) entry.register = undefined
        entry.listReviews = undefined
        break
      case 'listReviews':
        entry.listReviews = frame
        entry.repoKey = frame.repoKey
        break
      case 'telemetry':
        this.sendTelemetry(frame)
        return
    }
    this.deps.client.send(frame)
  }

  activateBrowserTab(tabId: number): void {
    const entry = [...this.ports.entries()].find(([port, value]) => port.sender?.tab?.id === tabId && value.register)?.[1]
    if (entry?.documentId) this.deps.client.send({ v: 1, id: crypto.randomUUID(), ts: Date.now(), type: 'activate', documentId: entry.documentId })
    else this.deps.client.send({ v: 1, id: crypto.randomUUID(), ts: Date.now(), type: 'clearActive' })
  }

  private sendTelemetry(frame: TelemetryFrameT): void {
    if (this.deps.client.send(frame)) return
    this.pendingTelemetry.push(frame)
    if (this.pendingTelemetry.length > MAX_PENDING_TELEMETRY) this.pendingTelemetry.shift()
  }

  private onClientStatus(s: HubStatus): void {
    this.setStatus({ ...s })
  }

  private onHubFrame(frame: HubFrame): void {
    if (frame.type === 'state') this.lastState = frame
    if (frame.type === 'reviews') this.lastReviews.set(frame.repoKey, frame)
    if (frame.type === 'group') {
      const shouldOpen = frame.group?.status === 'ready' && frame.group.groupId === this.preparingRequestId
      this.lastGroup = frame
      void this.deps.saveGroup?.(frame).catch(() => undefined)
      if (frame.preparation && !frame.preparation.error) this.preparingRequestId = frame.preparation.requestId
      if (shouldOpen && frame.group) {
        this.preparingRequestId = null
        void this.deps.reviewTabs?.openInitial(frame.group)
      }
    }
    if (frame.type === 'reviewItemResult' && frame.source === 'ai' && frame.documentId && this.lastGroup?.group) {
      const origin = [...this.ports.values()].find((entry) => entry.documentId === frame.documentId)
      const tabId = origin ? [...this.ports.entries()].find(([, entry]) => entry === origin)?.[0].sender?.tab?.id : undefined
      void this.deps.reviewTabs?.advanceAfterAi(this.lastGroup.group, frame.pr, tabId)
    }
    this.broadcast({ kind: 'frame', frame })
  }

  private setStatus(status: HubStatusMessage): void {
    this.status = status
    this.broadcast({ kind: 'status', status })
  }

  private broadcast(event: PortEvent): void {
    for (const port of this.ports.keys()) this.post(port, event)
  }

  private post(port: BrokerPort, event: PortEvent): void {
    try {
      port.postMessage(event)
    } catch {
      this.ports.delete(port)
    }
  }
}
