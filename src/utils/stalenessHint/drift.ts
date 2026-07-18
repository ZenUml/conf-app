import { forgeRequest } from '@/utils/requestUtil'
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'

/**
 * Drift = number of page versions newer than the diagram's last update.
 * Spike-verified recipe (2026-07-18 findings, Q3): the v2 versions endpoint
 * is sorted newest-first with an opaque _links.next cursor — walk from the
 * front, stop at the first entry at/older than the cutoff, follow next only
 * when a full page is exhausted (drift >= 50, far past the threshold).
 * Observed latency 79-613ms; runs post-render on editor surfaces only.
 * Never throws: any failure counts as drift 0 (hint stays hidden).
 */

export async function countVersionsSince(pageId: string, sinceIso: string): Promise<number> {
  try {
    let url: string | null = `/wiki/api/v2/pages/${pageId}/versions?limit=50`
    let count = 0
    while (url) {
      const data: any = await forgeRequest(url)
      const results: Array<{ createdAt: string }> = data?.results ?? []
      for (const v of results) {
        if (v.createdAt <= sinceIso) return count
        count++
      }
      url = data?._links?.next ?? null
    }
    return count
  } catch (e) {
    console.debug('[staleness-hint] drift fetch failed, treating as 0', e)
    return 0
  }
}

interface DriftCache {
  pageVersion: number
  drift: number
}

function driftCacheKey(pageId: string): string {
  return ['stalenessDrift', encodeURIComponent(getClientDomain() || 'unknown'), encodeURIComponent(pageId)].join(':')
}

/** At most one versions fetch per (pageId, pageVersion) per browser. */
export async function getDrift(pageId: string, pageVersion: number, sinceIso: string): Promise<number> {
  try {
    const raw = localStorage.getItem(driftCacheKey(pageId))
    if (raw) {
      const cached = JSON.parse(raw) as Partial<DriftCache>
      if (cached.pageVersion === pageVersion && typeof cached.drift === 'number') {
        return cached.drift
      }
    }
  } catch {
    // cache is best-effort
  }
  const drift = await countVersionsSince(pageId, sinceIso)
  try {
    localStorage.setItem(driftCacheKey(pageId), JSON.stringify({ pageVersion, drift }))
  } catch {
    // cache is best-effort
  }
  return drift
}
