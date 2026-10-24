/**
 * Hub entry (`dist/hub.mjs`). Normally spawned detached by the `pr-panel-mcp`
 * shim; `pr-panel-mcp --hub` runs it in the foreground for debugging.
 *
 * Exit codes: 0 clean shutdown, 1 start-up failure, 75 another Hub is already
 * running (socket live or lifecycle lock held) — the shim then uses that Hub.
 * Lifecycle adapted from TemPad Dev's hub.ts (MIT, Baidu EFE team).
 */
import { rmSync, readFileSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import lockfile from 'proper-lockfile'
import { Analytics } from './analytics'
import { listenConsumerSocket } from './consumer-transport'
import { createLogger } from './log'
import { ReviewStore } from './review-store'
import { PrStatusStore } from './pr-status-store'
import { PrStatusSync } from './pr-status-sync'
import { HUB_VERSION, HubRuntime } from './runtime'
import { assertSafeSocketPath, ensurePrivateDir, migrateLegacyStore, PRIVATE_FILE_MODE, resolveRuntimePaths } from './runtime-paths'
import { createExtensionOriginPolicy } from './security'
import { startWebSocketServer, type StartedWebSocketServer } from './websocket-server'

export const EXIT_EXISTING_HUB = 75
const log = createLogger('hub')
const SOCKET_PROBE_TIMEOUT_MS = 300
const LOCK_STALE_MS = 15_000
const LOCK_UPDATE_MS = 5_000
const SHUTDOWN_TIMEOUT_MS = 2_000
/** Detached Hubs exit after this long with no agent connected. */
const DEFAULT_IDLE_EXIT_MS = 60_000

type Probe = 'live' | 'missing' | 'stale'

function probeSocket(path: string): Promise<Probe> {
  if (process.platform !== 'win32' && !assertSafeSocketPath(path)) return Promise.resolve('missing')
  return new Promise((resolve) => {
    const socket = connect(path)
    const done = (result: Probe): void => {
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => done('stale'), SOCKET_PROBE_TIMEOUT_MS)
    socket.once('connect', () => done('live'))
    socket.once('error', (error: NodeJS.ErrnoException) => done(error.code === 'ENOENT' ? 'missing' : 'stale'))
  })
}

function idleExitMs(foreground: boolean): number {
  const raw = process.env.PR_PANEL_IDLE_EXIT_MS
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_IDLE_EXIT_MS
  }
  return foreground ? 0 : DEFAULT_IDLE_EXIT_MS
}

async function main(): Promise<void> {
  const foreground = process.argv.includes('--foreground')
  const paths = resolveRuntimePaths()
  ensurePrivateDir(paths.dir)

  if ((await probeSocket(paths.socket)) === 'live') {
    log.info('A Hub is already listening. Exiting.')
    process.exit(EXIT_EXISTING_HUB)
  }

  let release: (() => Promise<void>) | null = null
  try {
    release = await lockfile.lock(paths.hubLock, {
      realpath: false,
      retries: 0,
      stale: LOCK_STALE_MS,
      update: LOCK_UPDATE_MS,
      onCompromised: (error) => {
        log.error('Hub lifecycle lock compromised. Exiting.', error)
        process.exit(1)
      },
    })
  } catch {
    log.info('Another Hub holds the lifecycle lock. Exiting.')
    process.exit(EXIT_EXISTING_HUB)
  }

  // The lock is ours; a socket file that does not answer is left over from a crash.
  if ((await probeSocket(paths.socket)) === 'live') {
    await release?.()
    process.exit(EXIT_EXISTING_HUB)
  }

  if (paths.legacyStoreDir) {
    const moved = migrateLegacyStore(paths.legacyStoreDir, paths.storeDir)
    if (moved > 0) log.info(`Copied ${moved} review file(s) from ${paths.legacyStoreDir} to ${paths.storeDir}`)
  }
  const store = new ReviewStore(paths.storeDir)
  const statuses = new PrStatusStore(paths.storeDir)
  const analytics = new Analytics({ token: process.env.PR_PANEL_MIXPANEL_TOKEN, idPath: paths.analyticsId })
  let statusSync: PrStatusSync | undefined
  const runtime = new HubRuntime({ store, statuses, analytics, hubVersion: HUB_VERSION, requestStatusSync: () => statusSync?.request() })
  statusSync = new PrStatusSync({ reviews: store, statuses, analytics, onChanged: (repoKey) => runtime.refreshReviews(repoKey) })

  let ws: StartedWebSocketServer | null = null
  let shuttingDown = false
  const consumer = await listenConsumerSocket(paths.socket, runtime).catch(async (error: unknown) => {
    log.error('Could not listen on the Hub socket', error)
    await release?.()
    process.exit(1)
  })

  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log.info(`${reason} Shutting down.`)
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref()
    runtime.queue.cancelWaiters()
    statusSync?.stop()
    consumer.close()
    await ws?.close()
    try {
      if (process.platform !== 'win32') rmSync(paths.socket, { force: true })
      const info = JSON.parse(readFileSync(paths.hubInfo, 'utf8')) as { pid?: unknown }
      if (info.pid === process.pid) rmSync(paths.hubInfo, { force: true })
    } catch {
      /* already gone */
    }
    await analytics.flush()
    await release?.().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT.'))
  process.on('SIGTERM', () => void shutdown('SIGTERM.'))

  try {
    ws = await startWebSocketServer({
      runtime,
      originPolicy: createExtensionOriginPolicy(process.env.PR_PANEL_ALLOWED_EXTENSION_ORIGINS),
    })
  } catch (error) {
    log.error('Could not start the WebSocket server', error)
    await shutdown('Start-up failed.')
    return
  }

  writeFileSync(
    paths.hubInfo,
    JSON.stringify({ pid: process.pid, port: ws.port, hubVersion: HUB_VERSION, socket: paths.socket, startedAt: Date.now() }),
    { mode: PRIVATE_FILE_MODE },
  )
  log.info(`Hub ${HUB_VERSION} ready: socket ${paths.socket}, ws://127.0.0.1:${ws.port}/`)
  statusSync.start()

  const idleMs = idleExitMs(foreground)
  if (idleMs > 0) {
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const check = (): void => {
      if (runtime.agentCount > 0) {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = null
      } else if (!idleTimer) {
        idleTimer = setTimeout(() => void shutdown(`No agent for ${idleMs} ms.`), idleMs)
      }
    }
    runtime.onChange(check)
    check()
  }
}

main().catch((error: unknown) => {
  log.error('Hub crashed during start-up', error)
  process.exit(1)
})
