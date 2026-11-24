import type { InlineEditDiagram } from '@/utils/analytics/catalog'
import { requestConfluenceJson } from '@/utils/byline/confluenceRequest'

export interface IntroAccount {
  accountId: string
  cloudId: string
}

export const introPropertyKey = (type: InlineEditDiagram) => `zenuml.mermaidInlineIntro.v1.${type}`

function cacheKey(account: IntroAccount, type: InlineEditDiagram) {
  return `${introPropertyKey(type)}:${account.cloudId}:${account.accountId}`
}

function propertyPath(account: IntroAccount, type: InlineEditDiagram) {
  return `/wiki/rest/api/user/${encodeURIComponent(account.accountId)}/property/${introPropertyKey(type)}`
}

type Marker = 'seen' | 'pending'

export interface IntroSeenStore {
  cached(account: IntroAccount, type: InlineEditDiagram): boolean
  seen(account: IntroAccount, type: InlineEditDiagram): Promise<boolean | undefined>
  record(account: IntroAccount, type: InlineEditDiagram): void
}

export function createIntroSeenStore(request = requestConfluenceJson): IntroSeenStore {
  const writes = new Set<string>()
  const recorded = new Set<string>()

  function readMarker(key: string) {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  }

  function cache(key: string, value: Marker) {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // The site property still works when browser storage is unavailable.
    }
  }

  async function persist(account: IntroAccount, type: InlineEditDiagram, key: string) {
    if (writes.has(key)) return
    writes.add(key)
    try {
      const response = await request(propertyPath(account, type), 'POST', { value: { seen: true } })
      if (response.ok || response.status === 409) cache(key, 'seen')
    } catch {
      // Keep the pending marker and retry on the next eligible visit.
    } finally {
      writes.delete(key)
    }
  }

  return {
    cached(account, type) {
      const key = cacheKey(account, type)
      return recorded.has(key) || readMarker(key) !== null
    },
    async seen(account, type) {
      const key = cacheKey(account, type)
      const marker = readMarker(key)
      if (marker === 'pending') void persist(account, type, key)
      if (recorded.has(key) || marker !== null) return true
      try {
        const response = await request(propertyPath(account, type), 'GET')
        if (response.ok) {
          cache(key, 'seen')
          return true
        }
        if (response.status === 404) return false
      } catch {
        // An unavailable lookup cannot tell us whether this author saw the intro.
      }
      return undefined
    },
    record(account, type) {
      const key = cacheKey(account, type)
      recorded.add(key)
      cache(key, 'pending')
      void persist(account, type, key)
    },
  }
}
