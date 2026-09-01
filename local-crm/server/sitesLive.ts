import { buildSitesResponse } from './sitesData'
import { loadMarketplaceRows } from './extensionsLive'
import type { SitesResponse } from '../src/data/sitesContract'

const CACHE_MS = 30_000
let cached: { expiresAt: number; value: Promise<SitesResponse> } | null = null

export function loadSitesResponse(options: { fresh?: boolean } = {}): Promise<SitesResponse> {
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.value
  const value = loadMarketplaceRows(options).then(rows => buildSitesResponse(rows, new Date().toISOString()))
  cached = { expiresAt: Date.now() + CACHE_MS, value }
  value.catch(() => {
    if (cached?.value === value) cached = null
  })
  return value
}
