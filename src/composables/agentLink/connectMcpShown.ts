/**
 * Daily dedupe for agent_link_mcp_button_shown.
 *
 * The event is the denominator for Connect MCP dialog opens. Fired once per
 * macro it would cost what copy_for_ai_impression did (19% of billable
 * volume), so it is limited to one event per viewer per UTC day. The record
 * lives in localStorage, keyed per site and account, so it is shared by every
 * macro the viewer sees in this app. When storage is unavailable nothing is
 * emitted: without the dedupe, an event per macro is the cost being avoided.
 */

const KEY_PREFIX = 'zenuml.connectMcpShown'

export interface ShownScope {
  cloudId?: string | null
  accountId?: string | null
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

function defaultStorage(): Storage | null {
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function createConnectMcpShownRecord(
  scope: ShownScope,
  storage: Storage | null = defaultStorage(),
  clock: () => number = Date.now,
) {
  const key = `${KEY_PREFIX}:${scope.cloudId || '-'}:${scope.accountId || '-'}`

  return {
    /**
     * Record that the button was shown. True when this is the viewer's first
     * showing today, i.e. when agent_link_mcp_button_shown should be emitted.
     */
    recordShown(): boolean {
      if (!storage) return false
      try {
        const today = utcDay(clock())
        if (storage.getItem(key) === today) return false
        storage.setItem(key, today)
        return true
      } catch {
        return false
      }
    },
  }
}

export type ConnectMcpShownRecord = ReturnType<typeof createConnectMcpShownRecord>
