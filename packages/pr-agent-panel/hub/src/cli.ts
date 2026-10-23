/**
 * `pr-panel-mcp`: the MCP stdio server an agent launches. It holds no state:
 * it finds (or starts) the shared Hub and pipes the agent's MCP stream to the
 * Hub's Unix socket. Adapted from TemPad Dev's cli.ts (MIT, Baidu EFE team;
 * see THIRD_PARTY_NOTICES.md).
 *
 * stdout is the MCP stream: everything else goes to stderr.
 *
 *   pr-panel-mcp          stdio shim (what .mcp.json runs)
 *   pr-panel-mcp --hub    run the Hub in the foreground (debugging)
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { fileURLToPath } from 'node:url'
import lockfile from 'proper-lockfile'
import { CLIENT_EVENT_METHOD } from '@zenuml/pr-panel-shared'
import { detectAgent } from './agent-detect'
import { createLogger } from './log'
import { assertSafeSocketPath, ensurePrivateDir, resolveRuntimePaths } from './runtime-paths'

const log = createLogger('cli')
const HUB_STARTUP_TIMEOUT_MS = 5_000
const CONNECT_RETRY_DELAY_MS = 200
const FAILED_RESTART_DELAY_MS = 5_000
const EXIT_EXISTING_HUB = 75
const HUB_ENTRY = fileURLToPath(new URL('./hub.mjs', import.meta.url))

const paths = resolveRuntimePaths()

let activeSocket: Socket | null = null

function exitCli(reason: string): never {
  log.info(`${reason} Exiting.`)
  activeSocket?.destroy()
  process.exit(0)
}

function connectHub(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    try {
      if (process.platform !== 'win32') assertSafeSocketPath(paths.socket)
    } catch (error) {
      reject(error)
      return
    }
    const socket = connect(paths.socket)
    socket.once('connect', () => {
      socket.removeAllListeners('error')
      resolve(socket)
    })
    socket.once('error', reject)
  })
}

function isRetryable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ECONNREFUSED'
}

async function connectWithRetry(timeoutMs: number): Promise<Socket> {
  const start = Date.now()
  let delay = CONNECT_RETRY_DELAY_MS
  for (;;) {
    try {
      return await connectHub()
    } catch (error) {
      const remaining = timeoutMs - (Date.now() - start)
      if (!isRetryable(error) || remaining <= 0) throw error
      await new Promise((r) => setTimeout(r, Math.min(delay, remaining)))
      delay = Math.min(delay * 1.5, 1_000)
    }
  }
}

function spawnHub(): ChildProcess {
  log.info('Starting the Hub...')
  return spawn(process.execPath, [HUB_ENTRY], { detached: true, stdio: 'ignore', env: process.env })
}

/** Leader election: whoever takes the start lock spawns the Hub; the others wait for its socket. */
async function startHubAndConnect(): Promise<Socket> {
  let release: (() => Promise<void>) | undefined
  try {
    release = await lockfile.lock(paths.startLock, {
      realpath: false,
      stale: 15_000,
      retries: { retries: 5, factor: 1.2, minTimeout: 50 },
    })
  } catch {
    log.info('Another shim is starting the Hub; waiting for it.')
    return connectWithRetry(HUB_STARTUP_TIMEOUT_MS)
  }
  let child: ChildProcess | null = null
  try {
    try {
      return await connectHub()
    } catch {
      /* not running: start it */
    }
    child = spawnHub()
    child.once('exit', (code) => {
      if (code === EXIT_EXISTING_HUB) log.info('Another Hub already runs; using it.')
    })
    child.on('error', (error) => log.error('Hub process error', error))
    const socket = await connectWithRetry(HUB_STARTUP_TIMEOUT_MS)
    child.unref()
    return socket
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    throw error
  } finally {
    await release?.().catch(() => undefined)
  }
}

function bridge(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    activeSocket = socket
    const agent = detectAgent(process.env)
    socket.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: CLIENT_EVENT_METHOD,
        params: { event: 'connect', kind: agent.kind, ...(agent.sessionId ? { sessionId: agent.sessionId } : {}) },
      })}\n`,
    )
    const onStdinEnd = (): void => exitCli('Agent closed stdin.')
    process.stdin.once('end', onStdinEnd)
    socket.once('close', () => {
      log.warn('Lost the Hub connection; reconnecting.')
      activeSocket = null
      process.stdin.off('end', onStdinEnd)
      process.stdin.unpipe(socket)
      socket.unpipe(process.stdout)
      resolve()
    })
    socket.on('error', (error) => log.warn('Hub socket error', error))
    process.stdin.pipe(socket, { end: false })
    socket.pipe(process.stdout, { end: false })
  })
}

async function runShim(): Promise<void> {
  ensurePrivateDir(paths.dir)
  process.on('SIGINT', () => exitCli('SIGINT.'))
  process.on('SIGTERM', () => exitCli('SIGTERM.'))
  for (;;) {
    try {
      const socket = await connectHub().catch(() => startHubAndConnect())
      await bridge(socket)
    } catch (error) {
      log.error(`Could not reach the Hub; retrying in ${FAILED_RESTART_DELAY_MS / 1000} s.`, error)
      await new Promise((r) => setTimeout(r, FAILED_RESTART_DELAY_MS))
    }
  }
}

function runForegroundHub(): void {
  const child = spawn(process.execPath, [HUB_ENTRY, '--foreground'], { stdio: 'inherit', env: process.env })
  const forward = (signal: NodeJS.Signals): void => {
    child.kill(signal)
  }
  process.on('SIGINT', forward)
  process.on('SIGTERM', forward)
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
}

if (process.argv.includes('--hub')) runForegroundHub()
else void runShim()
