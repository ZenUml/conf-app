import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BRIDGE_SUBPROTOCOL,
  HUB_HANDSHAKE_TIMEOUT_MS,
  HUB_PROBE_SERVICE,
  KEEPALIVE_INTERVAL_MS,
  PORT_CANDIDATES,
  PROTOCOL_VERSION,
  RECONNECT_DELAY_MS,
} from '@zenuml/pr-panel-shared'
import { HubClient, getPortCandidates, type HubDisconnectReason, type WebSocketLike } from './hub-client'

// ---------------------------------------------------------------- fakes

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = []
  readyState = 0
  sent: string[] = []
  closedWith: { code?: number; reason?: string } | null = null
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close(code?: number, reason?: string) {
    this.readyState = 3
    this.closedWith = { code, reason }
  }
  // test helpers
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  receive(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) })
  }
  serverClose() {
    this.readyState = 3
    this.onclose?.({ code: 1006 })
  }
  get frames() {
    return this.sent.map((s) => JSON.parse(s) as { type: string; id: string; [k: string]: unknown })
  }
}

const OUR_PROBE = { service: HUB_PROBE_SERVICE, protocolVersion: PROTOCOL_VERSION, hubVersion: '0.1.0' }

function makeFetch(byPort: Record<number, unknown>) {
  const calls: number[] = []
  const fn = vi.fn(async (input: string, init?: { cache?: string }) => {
    const port = Number(new URL(input).port)
    calls.push(port)
    expect(init?.cache).toBe('no-store')
    if (!(port in byPort)) throw new TypeError('Failed to fetch')
    return { ok: true, json: async () => byPort[port] }
  })
  return { fn, calls }
}

let ids = 0
function makeClient(byPort: Record<number, unknown>, lastPort?: number) {
  const f = makeFetch(byPort)
  const setLastPort = vi.fn()
  const client = new HubClient({
    fetch: f.fn,
    WebSocket: FakeWebSocket,
    extVersion: '9.9.9',
    getLastPort: () => lastPort,
    setLastPort,
    newId: () => `id-${++ids}`,
  })
  return { client, calls: f.calls, setLastPort }
}

/** Flush the probe loop's awaits. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function registeredFor(ws: FakeWebSocket, protocolVersion: number = PROTOCOL_VERSION) {
  const hello = ws.frames.find((f) => f.type === 'hello')!
  return { v: 1, id: 'r1', ts: 1, type: 'registered', protocolVersion, hubVersion: '0.1.0', inReplyTo: hello.id }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
})
afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------- tests

describe('getPortCandidates', () => {
  it('puts a known last port first and keeps the rest in order', () => {
    expect(getPortCandidates(PORT_CANDIDATES[2])).toEqual([PORT_CANDIDATES[2], PORT_CANDIDATES[0], PORT_CANDIDATES[1], PORT_CANDIDATES[3]])
  })
  it('ignores a last port that is not one of ours', () => {
    expect(getPortCandidates(8080)).toEqual([...PORT_CANDIDATES])
    expect(getPortCandidates(null)).toEqual([...PORT_CANDIDATES])
  })
})

describe('HubClient', () => {
  it('probes the last good port first, then the list in order, and stops at the first Hub', async () => {
    const last = PORT_CANDIDATES[2]
    const { client, calls } = makeClient({ [PORT_CANDIDATES[1]]: OUR_PROBE }, last)
    client.start()
    await settle()
    expect(calls).toEqual([last, PORT_CANDIDATES[0], PORT_CANDIDATES[1]])
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0]!.url).toBe(`ws://127.0.0.1:${PORT_CANDIDATES[1]}/`)
    expect(FakeWebSocket.instances[0]!.protocols).toBe(BRIDGE_SUBPROTOCOL)
    client.stop()
  })

  it("rejects a stranger's probe JSON and reports not_running", async () => {
    const { client, calls } = makeClient({
      [PORT_CANDIDATES[0]]: { service: 'some-other-dev-server', protocolVersion: 1, hubVersion: '1' },
      [PORT_CANDIDATES[1]]: { hello: 'world' },
      [PORT_CANDIDATES[2]]: 'not json object',
    })
    const statuses: string[] = []
    const disconnects: HubDisconnectReason[] = []
    client.on('status', (s) => statuses.push(s.state))
    client.on('disconnected', (d) => disconnects.push(d.reason))
    client.start()
    await settle()
    expect(calls).toEqual([...PORT_CANDIDATES])
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(statuses).toEqual(['probing', 'not_running'])
    expect(disconnects).toEqual(['not_running'])
    client.stop()
  })

  it('sends hello and becomes connected on a matching registered frame', async () => {
    const { client, setLastPort } = makeClient({ [PORT_CANDIDATES[0]]: OUR_PROBE })
    const connected = vi.fn()
    client.on('connected', connected)
    client.start()
    await settle()
    const ws = FakeWebSocket.instances[0]!
    ws.open()
    expect(ws.frames[0]).toMatchObject({ type: 'hello', v: 1, extVersion: '9.9.9', protocolVersion: PROTOCOL_VERSION })
    ws.receive(registeredFor(ws))
    expect(client.status).toMatchObject({ state: 'connected', port: PORT_CANDIDATES[0], hubVersion: '0.1.0' })
    expect(connected).toHaveBeenCalledWith(expect.objectContaining({ port: PORT_CANDIDATES[0], hubVersion: '0.1.0' }))
    expect(setLastPort).toHaveBeenCalledWith(PORT_CANDIDATES[0])
    expect(client.send({ v: 1, id: 'x', ts: 1, type: 'activate', documentId: 'd' })).toBe(true)
    client.stop()
  })

  it('closes when no registered frame arrives within the handshake timeout, then retries after the reconnect delay', async () => {
    const { client } = makeClient({ [PORT_CANDIDATES[0]]: OUR_PROBE })
    const reasons: HubDisconnectReason[] = []
    client.on('disconnected', (d) => reasons.push(d.reason))
    client.start()
    await settle()
    const ws = FakeWebSocket.instances[0]!
    ws.open()
    vi.advanceTimersByTime(HUB_HANDSHAKE_TIMEOUT_MS - 1)
    expect(ws.closedWith).toBeNull()
    vi.advanceTimersByTime(1)
    expect(ws.closedWith?.code).toBe(4000)
    expect(reasons).toEqual(['closed'])
    expect(client.isConnected).toBe(false)

    vi.advanceTimersByTime(RECONNECT_DELAY_MS - 1)
    await settle()
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    await settle()
    expect(FakeWebSocket.instances).toHaveLength(2)
    client.stop()
  })

  it('closes with protocol_mismatch when registered names another protocol version', async () => {
    const { client } = makeClient({ [PORT_CANDIDATES[0]]: OUR_PROBE })
    const reasons: HubDisconnectReason[] = []
    client.on('disconnected', (d) => reasons.push(d.reason))
    client.start()
    await settle()
    const ws = FakeWebSocket.instances[0]!
    ws.open()
    ws.receive(registeredFor(ws, PROTOCOL_VERSION + 1))
    expect(ws.closedWith?.code).toBe(4001)
    expect(reasons).toEqual(['protocol_mismatch'])
    expect(client.status).toMatchObject({ state: 'not_running', reason: 'protocol_mismatch' })
    client.stop()
  })

  it("treats the Hub's protocol_mismatch error frame the same way", async () => {
    const { client } = makeClient({ [PORT_CANDIDATES[0]]: OUR_PROBE })
    client.start()
    await settle()
    const ws = FakeWebSocket.instances[0]!
    ws.open()
    ws.receive({ v: 1, id: 'e', ts: 1, type: 'error', code: 'protocol_mismatch', message: 'v2 only' })
    expect(client.status.reason).toBe('protocol_mismatch')
    client.stop()
  })

  it('pings every KEEPALIVE_INTERVAL_MS while connected and stops after close', async () => {
    const { client } = makeClient({ [PORT_CANDIDATES[0]]: OUR_PROBE })
    client.start()
    await settle()
    const ws = FakeWebSocket.instances[0]!
    ws.open()
    ws.receive(registeredFor(ws))
    const pings = () => ws.frames.filter((f) => f.type === 'ping').length
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS - 1)
    expect(pings()).toBe(0)
    vi.advanceTimersByTime(1)
    expect(pings()).toBe(1)
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS * 2)
    expect(pings()).toBe(3)
    ws.serverClose()
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS * 2)
    expect(pings()).toBe(3)
    client.stop()
  })

  it('reconnects RECONNECT_DELAY_MS after the Hub drops a live connection, and emits frames but not pongs', async () => {
    const { client } = makeClient({ [PORT_CANDIDATES[0]]: OUR_PROBE })
    const frames: string[] = []
    const events: { reason: HubDisconnectReason; wasConnected: boolean }[] = []
    client.on('frame', (f) => frames.push(f.type))
    client.on('disconnected', (d) => events.push(d))
    client.start()
    await settle()
    const ws = FakeWebSocket.instances[0]!
    ws.open()
    ws.receive(registeredFor(ws))
    ws.receive({ v: 1, id: 'p', ts: 1, type: 'pong', inReplyTo: 'x' })
    ws.receive({ v: 1, id: 's', ts: 1, type: 'state', activeDocumentId: null, sessions: [], agents: [], tasks: [] })
    ws.receive({ garbage: true })
    expect(frames).toEqual(['state'])

    ws.serverClose()
    expect(events).toEqual([{ reason: 'closed', wasConnected: true }])
    vi.advanceTimersByTime(RECONNECT_DELAY_MS)
    await settle()
    expect(FakeWebSocket.instances).toHaveLength(2)
    client.stop()
  })

  it('does not probe or reconnect after stop()', async () => {
    const { client, calls } = makeClient({})
    client.start()
    await settle()
    const before = calls.length
    client.stop()
    vi.advanceTimersByTime(RECONNECT_DELAY_MS * 3)
    await settle()
    expect(calls.length).toBe(before)
    expect(client.status.state).toBe('disabled')
  })
})
