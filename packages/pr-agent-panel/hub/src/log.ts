/**
 * Tiny stderr logger. Never writes to stdout: in the CLI shim stdout is the
 * MCP stream, and one stray byte breaks the agent's JSON-RPC parser.
 */
type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function threshold(): number {
  const raw = (process.env.PR_PANEL_LOG_LEVEL ?? 'info').toLowerCase()
  if (raw === 'silent') return Number.POSITIVE_INFINITY
  return raw in ORDER ? ORDER[raw as Level] : ORDER.info
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function write(level: Level, scope: string, message: string, detail?: unknown): void {
  if (ORDER[level] < threshold()) return
  const suffix = detail === undefined ? '' : ` ${describe(detail)}`
  process.stderr.write(`[pr-panel ${scope}] ${level.toUpperCase()} ${message}${suffix}\n`)
}

export interface Logger {
  debug(message: string, detail?: unknown): void
  info(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  error(message: string, detail?: unknown): void
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, d) => write('debug', scope, m, d),
    info: (m, d) => write('info', scope, m, d),
    warn: (m, d) => write('warn', scope, m, d),
    error: (m, d) => write('error', scope, m, d),
  }
}
