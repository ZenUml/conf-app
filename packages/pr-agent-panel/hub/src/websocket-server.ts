/**
 * Loopback HTTP + WebSocket server for the browser extension. Shape adapted
 * from TemPad Dev's websocket-server.ts (MIT, Baidu EFE team; see
 * THIRD_PARTY_NOTICES.md): fixed port candidates, Origin policy, fixed
 * subprotocol, payload cap.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  BRIDGE_SUBPROTOCOL,
  HUB_PROBE_SERVICE,
  MAX_PAYLOAD_BYTES,
  PORT_CANDIDATES,
  PROTOCOL_VERSION,
  parseExtensionFrame,
  type HubProbeResponse,
} from '@zenuml/pr-panel-shared'
import { createLogger } from './log'
import type { HubRuntime } from './runtime'
import { createExtensionOriginPolicy, isAllowedWebSocketRequest, type ExtensionOriginPolicy } from './security'

const log = createLogger('ws')

/** One connection per browser profile; a few profiles at most. */
export const MAX_EXTENSION_CONNECTIONS = 4
export const LOOPBACK_HOST = '127.0.0.1'

export interface WebSocketServerOptions {
  runtime: HubRuntime
  portCandidates?: readonly number[]
  originPolicy?: ExtensionOriginPolicy
  maxConnections?: number
}

export interface StartedWebSocketServer {
  port: number
  server: Server
  close(): Promise<void>
}

/** Accept only when the client offers our subprotocol. A missing header is rejected too. */
export function offersBridgeSubprotocol(header: string | string[] | undefined): boolean {
  if (!header) return false
  const values = (Array.isArray(header) ? header.join(',') : header).split(',').map((v) => v.trim())
  return values.includes(BRIDGE_SUBPROTOCOL)
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

export async function startWebSocketServer(options: WebSocketServerOptions): Promise<StartedWebSocketServer> {
  const { runtime } = options
  const policy = options.originPolicy ?? createExtensionOriginPolicy()
  const maxConnections = options.maxConnections ?? MAX_EXTENSION_CONNECTIONS
  const probe: HubProbeResponse = { service: HUB_PROBE_SERVICE, protocolVersion: PROTOCOL_VERSION, hubVersion: runtime.hubVersion }

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
    handleProtocols: (protocols) => (protocols.has(BRIDGE_SUBPROTOCOL) ? BRIDGE_SUBPROTOCOL : false),
  })

  const http = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && path === '/' && !(req.url ?? '').includes('?')) {
      const body = JSON.stringify(probe)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(body)
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  })

  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const origin = req.headers.origin
    if (wss.clients.size >= maxConnections) {
      log.warn('Rejected WebSocket handshake: connection limit reached.')
      rejectUpgrade(socket, 503, 'Service Unavailable')
      return
    }
    if (!isAllowedWebSocketRequest(origin, req.url, policy)) {
      log.warn('Rejected WebSocket handshake: Origin or path not allowed.', { origin: origin ?? '<missing>', path: req.url })
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }
    if (!offersBridgeSubprotocol(req.headers['sec-websocket-protocol'])) {
      log.warn('Rejected WebSocket handshake: missing or wrong subprotocol.')
      rejectUpgrade(socket, 400, 'Bad Request')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws, runtime))
  })

  const port = await listenOnFirstFree(http, options.portCandidates ?? PORT_CANDIDATES)
  log.info(`WebSocket server listening on ${LOOPBACK_HOST}:${port}`)

  return {
    port,
    server: http,
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate()
        wss.close()
        http.close(() => resolve())
        http.closeAllConnections()
      }),
  }
}

function attach(ws: WebSocket, runtime: HubRuntime): void {
  const connId = randomUUID()
  runtime.attachExtension({
    id: connId,
    send: (frame) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame))
    },
  })
  log.info(`Extension connected. Connections: ${runtime.connectionCount}`)
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      runtime.rejectFrame(connId, 'Binary frames are not accepted.')
      return
    }
    const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8')
    const frame = parseExtensionFrame(text)
    if (!frame) {
      runtime.rejectFrame(connId, 'Unrecognised frame.', idOf(text))
      return
    }
    try {
      const { close } = runtime.handleExtensionFrame(connId, frame)
      if (close) ws.close(4001, 'protocol_mismatch')
    } catch (error) {
      log.error('Frame handler failed', error)
    }
  })
  ws.on('close', () => {
    runtime.detachExtension(connId)
    log.info(`Extension disconnected. Connections: ${runtime.connectionCount}`)
  })
  ws.on('error', (error) => log.debug('WebSocket error', error))
}

function idOf(text: string): string | undefined {
  try {
    const raw: unknown = JSON.parse(text)
    const id = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : undefined
    return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : undefined
  } catch {
    return undefined
  }
}

async function listenOnFirstFree(server: Server, candidates: readonly number[]): Promise<number> {
  for (const candidate of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off('listening', onListening)
          reject(error)
        }
        const onListening = (): void => {
          server.off('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(candidate, LOOPBACK_HOST)
      })
      const address = server.address()
      return address && typeof address === 'object' ? address.port : candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        log.warn(`Port ${candidate} in use; trying the next candidate.`)
        continue
      }
      throw error
    }
  }
  throw new Error(`No free port among ${candidates.join(', ')}.`)
}
