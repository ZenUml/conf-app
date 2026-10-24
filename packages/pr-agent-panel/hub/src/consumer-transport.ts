/**
 * The Hub's Unix socket (named pipe on Windows). Every connection speaks
 * newline-delimited JSON-RPC; its first line decides what it is:
 *
 *  - `notifications/prpanel/client-event` {event:'connect'} — an MCP stdio
 *    shim. The rest of the stream is the agent's MCP session.
 *  - a `prpanel/client-hook` request — a one-shot lifecycle hook; answered
 *    with a ClientHookResponse, then the socket ends.
 *
 * Structure adapted from TemPad Dev's consumer socket (MIT, Baidu EFE team;
 * see THIRD_PARTY_NOTICES.md).
 */
import { chmodSync, unlinkSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { deserializeMessage, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import {
  CLIENT_EVENT_METHOD,
  ClientEventParamsSchema,
  ClientHookRequestSchema,
  HOOK_METHOD,
  MAX_PAYLOAD_BYTES,
  type ClientEventParams,
} from '@zenuml/pr-panel-shared'
import { createLogger } from './log'
import { createMcpServer } from './mcp-server'
import type { HubRuntime } from './runtime'
import { assertSafeSocketPath } from './runtime-paths'

const log = createLogger('consumer')

/** Splits a byte stream into lines; refuses a line longer than MAX_PAYLOAD_BYTES. */
export class LineSplitter {
  private buffer = ''
  push(chunk: Buffer | string): string[] | 'overflow' {
    this.buffer += chunk.toString()
    const lines: string[] = []
    let index: number
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '')
      this.buffer = this.buffer.slice(index + 1)
      if (line.trim()) lines.push(line)
    }
    if (this.buffer.length > MAX_PAYLOAD_BYTES) return 'overflow'
    return lines
  }
  /** Whatever follows the last complete line. */
  rest(): string {
    const rest = this.buffer
    this.buffer = ''
    return rest
  }
}

/**
 * MCP `Transport` over an already-connected socket, NDJSON both ways.
 * Lines carrying CLIENT_EVENT_METHOD are taken out of the MCP stream.
 */
export class SocketServerTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: <T extends JSONRPCMessage>(message: T) => void
  private readonly splitter = new LineSplitter()
  private closed = false
  private started = false

  constructor(
    private readonly socket: Socket,
    private readonly initialLines: string[],
    private readonly initialRest: string,
    private readonly onClientEvent: (params: ClientEventParams) => void,
  ) {
    socket.on('close', () => this.finish())
    socket.on('error', (error) => this.onerror?.(error))
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('SocketServerTransport already started.')
    this.started = true
    for (const line of this.initialLines) this.handleLine(line)
    if (this.initialRest) this.ingest(this.initialRest)
    this.socket.on('data', (chunk: Buffer) => this.ingest(chunk))
    this.socket.resume()
  }

  send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.socket.write(serializeMessage(message), (error) => (error ? reject(error) : resolve()))
    })
  }

  async close(): Promise<void> {
    if (!this.socket.destroyed) this.socket.end()
    this.finish()
  }

  private finish(): void {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }

  private ingest(chunk: Buffer | string): void {
    const lines = this.splitter.push(chunk)
    if (lines === 'overflow') {
      this.onerror?.(new Error('MCP message exceeds the payload limit.'))
      this.socket.destroy()
      return
    }
    for (const line of lines) this.handleLine(line)
  }

  private handleLine(line: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      this.onerror?.(new Error('Invalid JSON on the MCP stream.'))
      return
    }
    if (isClientEvent(raw)) {
      const params = ClientEventParamsSchema.safeParse(raw.params)
      if (params.success) this.onClientEvent(params.data)
      return
    }
    try {
      this.onmessage?.(deserializeMessage(line))
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

function isClientEvent(raw: unknown): raw is { method: string; params: unknown } {
  return typeof raw === 'object' && raw !== null && (raw as { method?: unknown }).method === CLIENT_EVENT_METHOD
}

function rpcId(raw: unknown): string | number | null {
  const id = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : undefined
  return typeof id === 'string' || typeof id === 'number' ? id : null
}

/** Route one fresh socket by its first line. */
export function handleConsumerSocket(socket: Socket, runtime: HubRuntime): void {
  const splitter = new LineSplitter()
  const onData = (chunk: Buffer): void => {
    const lines = splitter.push(chunk)
    if (lines === 'overflow') {
      socket.destroy()
      return
    }
    if (!lines.length) return
    socket.off('data', onData)
    socket.pause()
    route(socket, runtime, lines, splitter.rest())
  }
  socket.on('data', onData)
  socket.on('error', (error) => log.debug('Consumer socket error', error))
}

function route(socket: Socket, runtime: HubRuntime, lines: string[], rest: string): void {
  const [first, ...others] = lines
  let raw: unknown
  try {
    raw = JSON.parse(first)
  } catch {
    socket.destroy()
    return
  }
  const method = typeof raw === 'object' && raw !== null ? (raw as { method?: unknown }).method : undefined

  if (method === HOOK_METHOD) {
    answerHook(socket, runtime, raw)
    return
  }

  if (method === CLIENT_EVENT_METHOD) {
    const params = ClientEventParamsSchema.safeParse((raw as { params?: unknown }).params)
    if (!params.success || params.data.event !== 'connect') {
      socket.destroy()
      return
    }
    attachMcpConsumer(socket, runtime, params.data, others, rest)
    return
  }

  log.warn('Closing a socket that did not announce itself.')
  socket.destroy()
}

function answerHook(socket: Socket, runtime: HubRuntime, raw: unknown): void {
  const id = rpcId(raw)
  const parsed = ClientHookRequestSchema.safeParse((raw as { params?: unknown }).params)
  let reply: object
  if (id === null) {
    socket.destroy()
    return
  }
  if (!parsed.success) {
    reply = { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid hook request.' } }
  } else {
    try {
      reply = { jsonrpc: '2.0', id, result: runtime.handleHook(parsed.data) }
    } catch (error) {
      log.warn('Hook handler failed', error)
      reply = { jsonrpc: '2.0', id, error: { code: -32603, message: 'Hook handler failed.' } }
    }
  }
  socket.end(`${JSON.stringify(reply)}\n`)
}

function attachMcpConsumer(
  socket: Socket,
  runtime: HubRuntime,
  hello: ClientEventParams,
  lines: string[],
  rest: string,
): void {
  const consumerId = runtime.connectAgent({
    kind: hello.kind,
    ...(hello.sessionId ? { sessionId: hello.sessionId } : {}),
    connectedAt: Date.now(),
  })
  log.info(`Agent connected (${hello.kind}). Agents: ${runtime.agentCount}`)
  const transport = new SocketServerTransport(socket, lines, rest, (params) => {
    if (params.event === 'connect') {
      runtime.updateAgent(consumerId, {
        kind: params.kind,
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        connectedAt: Date.now(),
      })
    }
  })
  const server = createMcpServer(runtime, consumerId)
  let gone = false
  const disconnect = (): void => {
    if (gone) return
    gone = true
    runtime.disconnectAgent(consumerId)
    server.close().catch((error: unknown) => log.debug('MCP server close failed', error))
    log.info(`Agent disconnected. Agents: ${runtime.agentCount}`)
  }
  socket.on('close', disconnect)
  server.connect(transport).catch((error: unknown) => {
    log.error('Could not attach MCP transport', error)
    socket.destroy()
    disconnect()
  })
}

/** Listen on the Hub socket. The caller has already proven no live Hub owns it. */
export function listenConsumerSocket(path: string, runtime: HubRuntime): Promise<Server> {
  if (process.platform !== 'win32' && assertSafeSocketPath(path)) unlinkSync(path)
  const server = createServer((socket) => handleConsumerSocket(socket, runtime))
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      try {
        if (process.platform !== 'win32') chmodSync(path, 0o600)
      } catch (error) {
        server.close()
        reject(error)
        return
      }
      resolve(server)
    })
  })
}
