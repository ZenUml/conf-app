import { describe, expect, it, vi } from 'vitest'
import type { HubFrame } from '@zenuml/pr-panel-shared'
import { McpBroker, type BrokerPort } from './broker'
import type { HubClientEvents } from './hub-client'

function fakeClient(connected = true) {
  const handlers: { [K in keyof HubClientEvents]?: ((p: HubClientEvents[K]) => void)[] } = {}
  const sent: { type: string; [k: string]: unknown }[] = []
  const client = {
    connected,
    status: { state: 'disabled' as const },
    start: vi.fn(),
    stop: vi.fn(),
    retryNow: vi.fn(),
    send: vi.fn((f: { type: string }) => {
      if (!client.connected) return false
      sent.push(f)
      return true
    }),
    on<K extends keyof HubClientEvents>(e: K, cb: (p: HubClientEvents[K]) => void) {
      ;(handlers[e] ??= [] as never[]).push(cb as never)
      return () => {}
    },
    fire<K extends keyof HubClientEvents>(e: K, p: HubClientEvents[K]) {
      for (const cb of (handlers[e] ?? []) as ((p: HubClientEvents[K]) => void)[]) cb(p)
    },
  }
  return { client, sent }
}

function fakePort() {
  const posted: { kind: string; [k: string]: unknown }[] = []
  let onMessage: (m: unknown) => void = () => {}
  let onDisconnect: () => void = () => {}
  const port: BrokerPort = {
    postMessage: (m) => posted.push(m as never),
    onMessage: { addListener: (cb) => (onMessage = cb) },
    onDisconnect: { addListener: (cb) => (onDisconnect = cb) },
  }
  return { port, posted, send: (m: unknown) => onMessage(m), disconnect: () => onDisconnect() }
}

const settle = () => new Promise((r) => setTimeout(r, 0))
const deps = (client: ReturnType<typeof fakeClient>['client']) => ({
  client,
  hasHostPermission: vi.fn(async () => true),
  getMcpAccess: vi.fn(async () => 'enabled' as const),
  setMcpAccess: vi.fn(async () => {}),
  openOptions: vi.fn(),
})
const pr = { host: 'github.com', owner: 'o', repo: 'r', number: 5 }
const f = (body: object) => ({ v: 1, id: crypto.randomUUID(), ts: 1, ...body })

describe('McpBroker', () => {
  it('replays the last state and the repo reviews to a new port', async () => {
    const { client } = fakeClient()
    const broker = new McpBroker(deps(client))
    client.fire('frame', f({ type: 'state', activeDocumentId: 'd1', sessions: [], agents: [], tasks: [] }) as HubFrame)
    client.fire('frame', f({ type: 'reviews', repoKey: 'github.com/o/r', items: [] }) as HubFrame)
    const p = fakePort()
    broker.addPort(p.port)
    p.send({ kind: 'hello', documentId: 'd1', repoKey: 'github.com/o/r' })
    await settle()
    expect(p.posted.map((m) => (m.kind === 'frame' ? (m.frame as { type: string }).type : m.kind))).toEqual(['status', 'state', 'reviews'])
  })

  it('forwards register, re-registers after a reconnect, and unregisters when the tab goes away', async () => {
    const { client, sent } = fakeClient()
    const broker = new McpBroker(deps(client))
    const p = fakePort()
    broker.addPort(p.port)
    p.send({ kind: 'frame', frame: f({ type: 'register', documentId: 'd1', pr }) })
    await settle()
    expect(sent.map((s) => s.type)).toEqual(['register'])
    client.fire('connected', { port: 47391, hubVersion: '1', connectMs: 12 })
    expect(sent.map((s) => s.type)).toEqual(['register', 'register', 'telemetry'])
    expect(sent[2]).toMatchObject({ event: 'pr_panel_hub_connected', props: { connect_ms: 12 } })
    p.disconnect()
    expect(sent.at(-1)).toMatchObject({ type: 'unregister', documentId: 'd1' })
  })

  it('queues a disconnect telemetry frame until the next connection, once per outage', async () => {
    const { client, sent } = fakeClient(false)
    new McpBroker(deps(client))
    client.fire('disconnected', { reason: 'not_running', wasConnected: false })
    client.fire('disconnected', { reason: 'not_running', wasConnected: false })
    client.connected = true
    client.fire('connected', { port: 47391, hubVersion: '1', connectMs: 5 })
    expect(sent.map((s) => s.event)).toEqual(['pr_panel_hub_disconnected', 'pr_panel_hub_connected'])
    expect(sent[0]).toMatchObject({ props: { hub_disconnect_reason: 'not_running' } })
  })

  it('opens the options page instead of enabling MCP access without the host permission', async () => {
    const { client } = fakeClient()
    const d = deps(client)
    d.hasHostPermission.mockResolvedValue(false)
    const broker = new McpBroker(d)
    const p = fakePort()
    broker.addPort(p.port)
    p.send({ kind: 'setMcpAccess', value: 'enabled' })
    await settle()
    expect(d.openOptions).toHaveBeenCalled()
    expect(d.setMcpAccess).not.toHaveBeenCalled()
  })

  it('does not start the Hub client while MCP access is disabled', async () => {
    const { client } = fakeClient()
    const d = deps(client)
    d.getMcpAccess.mockResolvedValue('disabled' as never)
    await new McpBroker(d).applyAccess()
    expect(client.start).not.toHaveBeenCalled()
    expect(client.stop).toHaveBeenCalled()
  })

  it('drops malformed port messages and never forwards a page hello or ping', async () => {
    const { client, sent } = fakeClient()
    const broker = new McpBroker(deps(client))
    const p = fakePort()
    broker.addPort(p.port)
    p.send({ kind: 'frame', frame: { type: 'register' } })
    p.send({ kind: 'frame', frame: f({ type: 'ping' }) })
    p.send({ kind: 'frame', frame: f({ type: 'hello', extVersion: 'x', protocolVersion: 1 }) })
    await settle()
    expect(sent).toEqual([])
  })
})
