/**
 * Shared frequency rules for the MCP promo surfaces (Fullscreen card, editor
 * new-diagram card, editor tip). The toolbar/More-menu entry is a permanent
 * action, not a promo, and is not governed by this.
 *
 * - Shown in at most MAX_SESSIONS browser sessions per viewer, so a promo the
 *   viewer ignores goes away on its own.
 * - Never shown again once dismissed (× on any promo hides all of them).
 * - Never shown again once the viewer engaged: copied the setup command or the
 *   prompt from the Connect MCP dialog. The frontend cannot see whether the
 *   agent actually connected (that is counted server-side), so a copy is the
 *   closest client-side signal that the viewer no longer needs the nudge.
 *
 * State lives in localStorage keyed per site and account, shared by every
 * macro and surface of this app. When storage is unavailable the promo stays
 * hidden: without a way to remember a dismissal it would reappear on every
 * macro, which is the nagging this is meant to prevent.
 */

export const MAX_SESSIONS = 3

const KEY_PREFIX = 'zenuml.mcpPromo'
const SESSION_KEY = 'zenuml.mcpPromo.session'

export interface PromoScope {
  cloudId?: string | null
  accountId?: string | null
}

interface PromoRecord {
  dismissed?: boolean
  engaged?: boolean
  sessions?: string[]
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

function safe<T>(fn: () => T): T | null {
  try {
    return fn()
  } catch {
    return null
  }
}

export function createMcpPromoState(
  scope: PromoScope,
  storage: Storage | null = safe(() => window.localStorage),
  session: Storage | null = safe(() => window.sessionStorage),
  newId: () => string = () => Math.random().toString(36).slice(2, 10),
) {
  const key = `${KEY_PREFIX}:${scope.cloudId || '-'}:${scope.accountId || '-'}`

  function read(): PromoRecord | null {
    if (!storage) return null
    let raw: string | null
    try {
      raw = storage.getItem(key)
    } catch {
      return null
    }
    if (raw === null) return {}
    const parsed = safe(() => JSON.parse(raw as string))
    return parsed && typeof parsed === 'object' ? (parsed as PromoRecord) : {}
  }

  function write(record: PromoRecord) {
    if (!storage) return
    safe(() => storage.setItem(key, JSON.stringify(record)))
  }

  function sessionId(): string | null {
    if (!session) return null
    let id = safe(() => session.getItem(SESSION_KEY))
    if (!id) {
      id = newId()
      if (safe(() => session.setItem(SESSION_KEY, id as string)) === null) return null
    }
    return id
  }

  return {
    /** Whether a promo may show now. Does not count an impression. */
    canShow(): boolean {
      const record = read()
      if (!record || record.dismissed || record.engaged) return false
      const sessions = record.sessions ?? []
      if (sessions.length < MAX_SESSIONS) return true
      const id = sessionId()
      return id !== null && sessions.includes(id)
    },
    /** Count this browser session towards MAX_SESSIONS (idempotent per session). */
    recordShown(): void {
      const record = read()
      const id = sessionId()
      if (!record || id === null) return
      const sessions = record.sessions ?? []
      if (sessions.includes(id)) return
      write({ ...record, sessions: [...sessions, id] })
    },
    dismiss(): void {
      const record = read()
      if (!record) return
      write({ ...record, dismissed: true })
    },
    markEngaged(): void {
      const record = read()
      if (!record) return
      write({ ...record, engaged: true })
    },
  }
}

export type McpPromoState = ReturnType<typeof createMcpPromoState>
