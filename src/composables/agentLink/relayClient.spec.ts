import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRelayClient, type RelayStateEvent } from './relayClient'
import type { AgentLinkBridgeOps } from './bridgeOps'

// Minimal mock matching the subset of the WebSocket API relayClient.ts uses
// (onopen/onmessage/onerror/onclose assignment + send/close). Tracks every
// instance so reconnect tests can assert how many sockets got constructed.
class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  sent: string[] = []
  closedByClient = false
  onopen: ((ev?: any) => void) | null = null
  onmessage: ((ev: any) => void) | null = null
  onerror: ((ev: any) => void) | null = null
  onclose: ((ev: any) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closedByClient = true
  }

  // --- test helpers, simulating server-driven events ---
  triggerOpen(): void {
    this.onopen?.({})
  }

  triggerMessage(data: string): void {
    this.onmessage?.({ data })
  }

  triggerUnexpectedClose(code = 1006, wasClean = false): void {
    this.onclose?.({ code, wasClean })
  }
}

function makeBridge(overrides: Partial<AgentLinkBridgeOps> = {}): AgentLinkBridgeOps {
  return {
    readPage: vi.fn().mockResolvedValue({ pageId: 'p1', title: 't', text: 'body' }),
    readDiagram: vi
      .fn()
      .mockResolvedValue({ contentId: 'c1', diagramType: 'sequence', dsl: 'A->B' }),
    writeDiagram: vi.fn().mockResolvedValue({ ok: true, version: 2, rendered: true }),
    ...overrides,
  }
}

// Flush the microtask queue enough times for the async op-dispatch chain
// (await bridge.op() -> send()) inside relayClient.ts's handleOp to settle.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Instant, synchronous "clock" so reconnect-backoff tests don't wait on
// real timers — the handler runs immediately when scheduled.
function instantClock() {
  return { setTimeout: (handler: () => void) => { handler(); return 0 } }
}

beforeEach(() => {
  MockWebSocket.instances = []
})

describe('createRelayClient', () => {
  it('op:read_page calls bridge.readPage and replies with a result envelope carrying the same id', async () => {
    const bridge = makeBridge()
    createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      WebSocketImpl: MockWebSocket as any,
    })
    const socket = MockWebSocket.instances[0]
    socket.triggerOpen()

    socket.triggerMessage(JSON.stringify({ kind: 'op', id: 'req-1', op: 'read_page' }))
    await flush()

    expect(bridge.readPage).toHaveBeenCalledTimes(1)
    expect(socket.sent).toHaveLength(1)
    expect(JSON.parse(socket.sent[0])).toEqual({
      kind: 'result',
      id: 'req-1',
      payload: { pageId: 'p1', title: 't', text: 'body' },
    })
  })

  it('op:read_diagram calls bridge.readDiagram and replies with a result envelope', async () => {
    const bridge = makeBridge()
    createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      WebSocketImpl: MockWebSocket as any,
    })
    const socket = MockWebSocket.instances[0]
    socket.triggerOpen()

    socket.triggerMessage(JSON.stringify({ kind: 'op', id: 'req-2', op: 'read_diagram' }))
    await flush()

    expect(bridge.readDiagram).toHaveBeenCalledTimes(1)
    expect(JSON.parse(socket.sent[0])).toEqual({
      kind: 'result',
      id: 'req-2',
      payload: { contentId: 'c1', diagramType: 'sequence', dsl: 'A->B' },
    })
  })

  it('op:update_diagram calls bridge.writeDiagram(dsl, summary) and replies with a result envelope', async () => {
    const bridge = makeBridge()
    createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      WebSocketImpl: MockWebSocket as any,
    })
    const socket = MockWebSocket.instances[0]
    socket.triggerOpen()

    socket.triggerMessage(
      JSON.stringify({
        kind: 'op',
        id: 'req-3',
        op: 'update_diagram',
        payload: { dsl: 'A->B: hi', summary: 'added a step' },
      })
    )
    await flush()

    expect(bridge.writeDiagram).toHaveBeenCalledWith('A->B: hi', 'added a step')
    expect(JSON.parse(socket.sent[0])).toEqual({
      kind: 'result',
      id: 'req-3',
      payload: { ok: true, version: 2, rendered: true },
    })
  })

  it('op:update_diagram fires onDiagramUpdated with the new DSL once the bridge write persists (the live-render fix)', async () => {
    const bridge = makeBridge()
    const onDiagramUpdated = vi.fn()
    createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      onDiagramUpdated,
      WebSocketImpl: MockWebSocket as any,
    })
    const socket = MockWebSocket.instances[0]
    socket.triggerOpen()

    socket.triggerMessage(
      JSON.stringify({
        kind: 'op',
        id: 'req-live',
        op: 'update_diagram',
        payload: { dsl: 'A->B: hi', summary: 'added a step' },
      })
    )
    await flush()

    expect(bridge.writeDiagram).toHaveBeenCalledWith('A->B: hi', 'added a step')
    expect(onDiagramUpdated).toHaveBeenCalledTimes(1)
    expect(onDiagramUpdated).toHaveBeenCalledWith('A->B: hi')
  })

  it('op:update_diagram does NOT fire onDiagramUpdated when the bridge write fails to persist', async () => {
    const bridge = makeBridge({
      writeDiagram: vi.fn().mockResolvedValue({ ok: false, reason: 'version_conflict' }),
    })
    const onDiagramUpdated = vi.fn()
    createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      onDiagramUpdated,
      WebSocketImpl: MockWebSocket as any,
    })
    const socket = MockWebSocket.instances[0]
    socket.triggerOpen()

    socket.triggerMessage(
      JSON.stringify({
        kind: 'op',
        id: 'req-fail',
        op: 'update_diagram',
        payload: { dsl: 'A->B: hi' },
      })
    )
    await flush()

    expect(onDiagramUpdated).not.toHaveBeenCalled()
    expect(JSON.parse(socket.sent[0])).toEqual({
      kind: 'result',
      id: 'req-fail',
      payload: { ok: false, reason: 'version_conflict' },
    })
  })

  it('op:update_diagram works with no onDiagramUpdated callback wired (backward compatible)', async () => {
    const bridge = makeBridge()
    createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      WebSocketImpl: MockWebSocket as any,
    })
    const socket = MockWebSocket.instances[0]
    socket.triggerOpen()

    socket.triggerMessage(
      JSON.stringify({ kind: 'op', id: 'req-nocb', op: 'update_diagram', payload: { dsl: 'A->B: hi' } })
    )

    await expect(flush()).resolves.toBeUndefined()
    expect(JSON.parse(socket.sent[0])).toMatchObject({ kind: 'result', id: 'req-nocb' })
  })

  it('a bridge failure (rejected promise) sends an error envelope with the same id', async () => {
    const bridge = makeBridge({ readPage: vi.fn().mockRejectedValue(new Error('boom')) })
    createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      WebSocketImpl: MockWebSocket as any,
    })
    const socket = MockWebSocket.instances[0]
    socket.triggerOpen()

    socket.triggerMessage(JSON.stringify({ kind: 'op', id: 'req-4', op: 'read_page' }))
    await flush()

    expect(JSON.parse(socket.sent[0])).toEqual({
      kind: 'error',
      id: 'req-4',
      payload: { message: 'boom' },
    })
  })

  it('an unrecognized op sends an error envelope instead of crashing the channel', async () => {
    const bridge = makeBridge()
    createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      WebSocketImpl: MockWebSocket as any,
    })
    const socket = MockWebSocket.instances[0]
    socket.triggerOpen()

    socket.triggerMessage(JSON.stringify({ kind: 'op', id: 'req-5', op: 'get_status' }))
    await flush()

    expect(JSON.parse(socket.sent[0])).toMatchObject({ kind: 'error', id: 'req-5' })
  })

  it('a ping envelope is ignored — no bridge call, no reply', async () => {
    const bridge = makeBridge()
    createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      WebSocketImpl: MockWebSocket as any,
    })
    const socket = MockWebSocket.instances[0]
    socket.triggerOpen()

    socket.triggerMessage(JSON.stringify({ kind: 'ping' }))
    await flush()

    expect(bridge.readPage).not.toHaveBeenCalled()
    expect(bridge.readDiagram).not.toHaveBeenCalled()
    expect(bridge.writeDiagram).not.toHaveBeenCalled()
    expect(socket.sent).toHaveLength(0)
  })

  it('emits an "op" state event on every incoming op (the only signal that the agent has paired)', async () => {
    const bridge = makeBridge()
    const events: RelayStateEvent[] = []
    createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      WebSocketImpl: MockWebSocket as any,
      onStateEvent: (e) => events.push(e),
    })
    const socket = MockWebSocket.instances[0]
    socket.triggerOpen()

    socket.triggerMessage(JSON.stringify({ kind: 'op', id: 'req-6', op: 'read_page' }))
    await flush()

    expect(events).toContainEqual({ type: 'open' })
    expect(events).toContainEqual({ type: 'op', op: 'read_page' })
  })

  it('an unexpected close triggers a reconnect, retrying up to maxReconnectAttempts', () => {
    const bridge = makeBridge()
    const events: RelayStateEvent[] = []
    createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      WebSocketImpl: MockWebSocket as any,
      onStateEvent: (e) => events.push(e),
      maxReconnectAttempts: 3,
      clock: instantClock(),
    })

    // Each reconnect attempt's new socket also never opens — closing it in
    // turn drives the next attempt (instant clock fires the backoff
    // synchronously, so each close call already has its successor socket by
    // the time it returns).
    MockWebSocket.instances[0].triggerUnexpectedClose() // attempt 1 -> socket #2
    MockWebSocket.instances[1].triggerUnexpectedClose() // attempt 2 -> socket #3
    MockWebSocket.instances[2].triggerUnexpectedClose() // attempt 3 -> socket #4
    MockWebSocket.instances[3].triggerUnexpectedClose() // exhausted -> no more sockets

    expect(MockWebSocket.instances).toHaveLength(4) // 1 initial + 3 reconnects
    expect(events.filter((e) => e.type === 'reconnecting')).toHaveLength(3)
    expect(events.some((e) => e.type === 'reconnect_failed')).toBe(true)
  })

  it('a deliberate close() does NOT trigger a reconnect', () => {
    const bridge = makeBridge()
    const events: RelayStateEvent[] = []
    const client = createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      WebSocketImpl: MockWebSocket as any,
      onStateEvent: (e) => events.push(e),
      maxReconnectAttempts: 3,
      clock: instantClock(),
    })
    MockWebSocket.instances[0].triggerOpen()

    client.close()

    expect(MockWebSocket.instances[0].closedByClient).toBe(true)
    expect(MockWebSocket.instances).toHaveLength(1) // no reconnect socket created
    expect(events.some((e) => e.type === 'reconnecting')).toBe(false)
    expect(client.getState()).toBe('closed')
  })

  it('a successful reconnect resets the attempt counter (a later close retries the full count again)', () => {
    const bridge = makeBridge()
    createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      WebSocketImpl: MockWebSocket as any,
      maxReconnectAttempts: 2,
      clock: instantClock(),
    })

    // First outage: 1 initial + 2 reconnect attempts = 3 sockets, then the
    // last one opens successfully (recovers).
    MockWebSocket.instances[0].triggerUnexpectedClose() // attempt 1 -> socket #2
    MockWebSocket.instances[1].triggerUnexpectedClose() // attempt 2 -> socket #3
    expect(MockWebSocket.instances).toHaveLength(3)
    MockWebSocket.instances[2].triggerOpen()

    // Second outage on the now-recovered socket: counter should have reset,
    // so it again gets 2 fresh reconnect attempts (not 0 remaining).
    MockWebSocket.instances[2].triggerUnexpectedClose() // attempt 1 -> socket #4
    MockWebSocket.instances[3].triggerUnexpectedClose() // attempt 2 -> socket #5
    expect(MockWebSocket.instances).toHaveLength(5) // +2 more reconnects
  })

  it('send() only writes to the socket once it is open', () => {
    const bridge = makeBridge()
    const client = createRelayClient({
      wsUrl: 'wss://backend.example/agent-link/channel?token=t&peer=macro',
      bridge,
      WebSocketImpl: MockWebSocket as any,
    })
    client.send({ kind: 'result', id: 'x', payload: {} })
    expect(MockWebSocket.instances[0].sent).toHaveLength(0)

    MockWebSocket.instances[0].triggerOpen()
    client.send({ kind: 'result', id: 'x', payload: {} })
    expect(MockWebSocket.instances[0].sent).toHaveLength(1)
  })
})
