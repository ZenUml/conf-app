/**
 * First-use discovery for the inline Connect MCP button.
 *
 * Inline header actions stay hidden until the macro is hovered. A customer
 * could not find Connect MCP that way, so for a viewer who has never opened its
 * dialog the button stays visible at rest for DISCOVERY_WINDOW_DAYS after it
 * was first shown to them; after that, or once they open it, it hides and
 * reveals on hover like the rest of the header.
 *
 * The same record deduplicates agent_link_mcp_button_shown to one event per
 * viewer per UTC day. State lives in localStorage, keyed per site and account,
 * so it is shared by every macro the viewer sees in this app. When storage is
 * unavailable the button falls back to hover and nothing is emitted: without
 * the dedupe, an event per macro would cost what copy_for_ai_impression did.
 */

export type ConnectMcpReveal = 'always' | 'hover'

export const DISCOVERY_WINDOW_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
const KEY_PREFIX = 'zenuml.connectMcpDiscovery'

interface DiscoveryState {
  firstShownAt?: number
  openedAt?: number
  lastShownDay?: string
}

export interface DiscoveryScope {
  cloudId?: string | null
  accountId?: string | null
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

function storageKey(scope: DiscoveryScope): string {
  return `${KEY_PREFIX}:${scope.cloudId || '-'}:${scope.accountId || '-'}`
}

function defaultStorage(): Storage | null {
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

function read(storage: Storage, key: string): DiscoveryState {
  const raw = storage.getItem(key)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function createConnectMcpDiscovery(
  scope: DiscoveryScope,
  storage: Storage | null = defaultStorage(),
  clock: () => number = Date.now,
) {
  const key = storageKey(scope)

  function update(change: (state: DiscoveryState) => DiscoveryState | null): boolean {
    if (!storage) return false
    try {
      const next = change(read(storage, key))
      if (next) storage.setItem(key, JSON.stringify(next))
      return true
    } catch {
      return false
    }
  }

  return {
    /** Whether the button shows at rest ('always') or only on hover. */
    reveal(): ConnectMcpReveal {
      if (!storage) return 'hover'
      try {
        const state = read(storage, key)
        if (state.openedAt) return 'hover'
        if (state.firstShownAt && clock() - state.firstShownAt >= DISCOVERY_WINDOW_DAYS * DAY_MS) return 'hover'
        return 'always'
      } catch {
        return 'hover'
      }
    },

    /**
     * Record that the button was shown. True when this is the viewer's first
     * showing today, i.e. when agent_link_mcp_button_shown should be emitted.
     */
    recordShown(): boolean {
      const now = clock()
      const today = utcDay(now)
      let first = false
      const ok = update(state => {
        if (state.lastShownDay === today) return null
        first = true
        return { ...state, firstShownAt: state.firstShownAt ?? now, lastShownDay: today }
      })
      return ok && first
    },

    /** The dialog was opened: discovery is over for this viewer. */
    recordOpened(): void {
      const now = clock()
      update(state => (state.openedAt ? null : { ...state, openedAt: now }))
    },
  }
}

export type ConnectMcpDiscovery = ReturnType<typeof createConnectMcpDiscovery>
