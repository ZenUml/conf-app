import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HUB_LOCK_NAME, HUB_SOCKET_NAME, RUNTIME_DIR_NAME, WINDOWS_PIPE_PATH } from '@zenuml/pr-panel-shared'

export interface RuntimePaths {
  dir: string
  /** Unix socket (POSIX) or named pipe (Windows) the agents connect to. */
  socket: string
  /** Hub lifecycle lock: held by the running Hub for its whole life. */
  hubLock: string
  /**
   * Start-up lock: held briefly by the CLI shim that wins leader election
   * while it spawns the Hub. Distinct from `hubLock`, otherwise the spawned
   * Hub would see its own leader's lock and exit 75.
   */
  startLock: string
  /** `{pid, port, hubVersion}` of the running Hub. */
  hubInfo: string
  storeDir: string
  analyticsId: string
}

/** `PR_PANEL_RUNTIME_DIR` overrides the default `<os tmp>/zenuml-pr-panel` (tests, side-by-side Hubs). */
export function resolveRuntimePaths(env: NodeJS.ProcessEnv = process.env): RuntimePaths {
  const dir = env.PR_PANEL_RUNTIME_DIR || join(tmpdir(), RUNTIME_DIR_NAME)
  return {
    dir,
    socket: process.platform === 'win32' ? WINDOWS_PIPE_PATH : join(dir, HUB_SOCKET_NAME),
    hubLock: join(dir, HUB_LOCK_NAME),
    startLock: join(dir, 'start.lock'),
    hubInfo: join(dir, 'hub.json'),
    storeDir: join(dir, 'store'),
    analyticsId: join(dir, 'analytics-id'),
  }
}

/** Create a 0700 directory and refuse one that is a symlink or belongs to another user. */
export function ensurePrivateDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform === 'win32') return
  const stat = lstatSync(dir)
  if (stat.isSymbolicLink()) throw new Error(`Refusing runtime directory ${dir}: it is a symlink.`)
  if (!stat.isDirectory()) throw new Error(`Refusing runtime directory ${dir}: not a directory.`)
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`Refusing runtime directory ${dir}: owned by uid ${stat.uid}.`)
  }
  if ((stat.mode & 0o077) !== 0) chmodSync(dir, 0o700)
}

/**
 * Before connecting to or unlinking a socket path: it must not be a symlink and
 * must belong to us. Returns false when the path does not exist.
 */
export function assertSafeSocketPath(path: string): boolean {
  if (process.platform === 'win32') return true
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  if (stat.isSymbolicLink()) throw new Error(`Refusing socket ${path}: it is a symlink.`)
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`Refusing socket ${path}: owned by uid ${stat.uid}.`)
  }
  return true
}

export const PRIVATE_FILE_MODE = 0o600
