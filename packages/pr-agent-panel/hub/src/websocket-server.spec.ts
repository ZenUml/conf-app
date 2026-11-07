import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { BRIDGE_SUBPROTOCOL, HUB_PROBE_SERVICE, parseHubFrame, type HubFrame } from '@zenuml/pr-panel-shared'
import { createExtensionOriginPolicy } from './security'
import { startWebSocketServer, type StartedWebSocketServer } from './websocket-server'
import { makeRuntime } from './test-helpers'

const ORIGIN = `chrome-extension://${'a'.repeat(32)}`
let started: StartedWebSocketServer | null = null

afterEach(async () => {
  await started?.close()
  started = null
})

async function start(policy = createExtensionOriginPolicy()) {
  const { runtime } = makeRuntime()
  started = await startWebSocketServer({ runtime, portCandidates: [0], originPolicy: policy })
  return { runtime, port: started.port }
}

function open(port: number, options: { origin?: string; protocol?: string | null; path?: string } = {}) {
  const protocols = options.protocol === null ? undefined : (options.protocol ?? BRIDGE_SUBPROTOCOL)
  return new WebSocket(`ws://127.0.0.1:${port}${options.path ?? '/'}`, protocols, {
    origin: options.origin ?? ORIGIN,
  })
}

function rejected(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
    ws.once('open', () => reject(new Error('handshake should have failed')))
    ws.once('error', () => resolve(-1))
  })
}

function collector(ws: WebSocket) {
  const frames: HubFrame[] = []
  const waiters: { type: string; resolve: (f: HubFrame) => void }[] = []
  ws.on('message', (data) => {
    const f = parseHubFrame(data.toString())
    if (!f) throw new Error(`unparseable hub frame: ${data.toString()}`)
    frames.push(f)
    for (const w of [...waiters]) {
      if (w.type === f.type) {
        waiters.splice(waiters.indexOf(w), 1)
        w.resolve(f)
      }
    }
  })
  return {
    frames,
    next<T extends HubFrame['type']>(type: T): Promise<Extract<HubFrame, { type: T }>> {
      const seen = frames.find((f) => f.type === type && !(f as { _taken?: boolean })._taken)
      if (seen) {
        ;(seen as { _taken?: boolean })._taken = true
        return Promise.resolve(seen as Extract<HubFrame, { type: T }>)
      }
      return new Promise((resolve) =>
        waiters.push({
          type,
          resolve: (f) => {
            ;(f as { _taken?: boolean })._taken = true
            resolve(f as Extract<HubFrame, { type: T }>)
          },
        }),
      )
    },
  }
}

const base = (id: string) => ({ v: 1, id, ts: Date.now() })

describe('WebSocket server', () => {
  it('answers the probe with HubProbeResponse JSON and 404s anything else', async () => {
    const { port } = await start()
    const res = await fetch(`http://127.0.0.1:${port}/`)
    expect(await res.json()).toEqual({ service: HUB_PROBE_SERVICE, protocolVersion: 2, hubVersion: '0.1.0' })
    expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404)
  })

  it('rejects a web Origin, an unlisted extension, a wrong path, and a wrong or missing subprotocol', async () => {
    const { port } = await start(createExtensionOriginPolicy(ORIGIN))
    expect(await rejected(open(port, { origin: 'https://github.com' }))).toBe(403)
    expect(await rejected(open(port, { origin: `chrome-extension://${'b'.repeat(32)}` }))).toBe(403)
    expect(await rejected(open(port, { path: '/ws' }))).toBe(403)
    expect(await rejected(open(port, { protocol: 'something-else' }))).toBe(400)
    expect(await rejected(open(port, { protocol: null }))).toBe(400)
  })

  it('hello -> registered + state, ping -> pong, bad frame -> error', async () => {
    const { port } = await start()
    const ws = open(port)
    const c = collector(ws)
    await new Promise((r) => ws.once('open', r))
    expect(ws.protocol).toBe(BRIDGE_SUBPROTOCOL)
    ws.send(JSON.stringify({ ...base('h1'), type: 'hello', extVersion: '0.1.0', protocolVersion: 2 }))
    const registered = await c.next('registered')
    expect(registered.inReplyTo).toBe('h1')
    expect((await c.next('state')).sessions).toEqual([])

    ws.send(JSON.stringify({ ...base('p1'), type: 'ping' }))
    expect((await c.next('pong')).inReplyTo).toBe('p1')

    ws.send(JSON.stringify({ ...base('x1'), type: 'nonsense' }))
    const error = await c.next('error')
    expect(error.code).toBe('bad_frame')
    expect(error.inReplyTo).toBe('x1')

    ws.send(Buffer.from([1, 2, 3]), { binary: true })
    expect((await c.next('error')).code).toBe('bad_frame')
    ws.close()
  })

  it('sends protocol_mismatch and closes', async () => {
    const { port } = await start()
    const ws = open(port)
    const c = collector(ws)
    await new Promise((r) => ws.once('open', r))
    const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)))
    ws.send(JSON.stringify({ ...base('h1'), type: 'hello', extVersion: '0.1.0', protocolVersion: 99 }))
    const error = await c.next('error')
    expect(error.code).toBe('protocol_mismatch')
    expect(await closed).toBe(4001)
  })

  it('caps simultaneous extension connections', async () => {
    const { runtime } = makeRuntime()
    started = await startWebSocketServer({ runtime, portCandidates: [0], maxConnections: 1 })
    const first = open(started.port)
    await new Promise((r) => first.once('open', r))
    expect(await rejected(open(started.port))).toBe(503)
    first.close()
  })
})
