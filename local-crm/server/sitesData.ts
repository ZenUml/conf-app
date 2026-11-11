import type { AppKey } from '../src/data/types'
import {
  SITES_CONTRACT_VERSION,
  type MarketplaceSiteRecord,
  type SitesResponse
} from '../src/data/sitesContract'

type RecordValue = Record<string, unknown>

const APP_BY_ADDON: Record<string, AppKey> = {
  'com.zenuml.confluence-addon-lite': 'lite',
  'com.zenuml.confluence-addon': 'full',
  'gptdock-confluence': 'dia',
  'com.pnd.jira.plugins.diagramly': 'dia',
  'my-api': 'api'
}

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function domain(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const hostname = raw.toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
  return hostname.endsWith('.atlassian.net')
    ? hostname.slice(0, -'.atlassian.net'.length)
    : hostname
}

/** Marketplace is the source of truth for cloud-id/site and licence context. */
export function buildSitesResponse(marketplaceRows: unknown[], generatedAt: string): SitesResponse {
  const sites = new Map<string, { cloudId: string; domain: string | null; apps: Set<AppKey>; licenseRows: number }>()
  for (const value of marketplaceRows) {
    const row = record(value)
    const cloudId = text(row?.cloudId)
    if (!row || !cloudId) continue
    const site = sites.get(cloudId) ?? { cloudId, domain: null, apps: new Set<AppKey>(), licenseRows: 0 }
    site.domain ??= domain(row.cloudSiteHostname)
    const app = text(row.addonKey)
    if (app && APP_BY_ADDON[app]) site.apps.add(APP_BY_ADDON[app])
    site.licenseRows++
    sites.set(cloudId, site)
  }
  const output: MarketplaceSiteRecord[] = [...sites.values()]
    .map(site => ({ ...site, apps: [...site.apps].sort(), licenseRows: site.licenseRows }))
    .sort((a, b) => (a.domain ?? a.cloudId).localeCompare(b.domain ?? b.cloudId))
  const hostnameMissingCount = output.filter(site => !site.domain).length
  return {
    contractVersion: SITES_CONTRACT_VERSION,
    generatedAt,
    source: { state: 'ok', records: marketplaceRows.length, detail: 'Marketplace licence export' },
    summary: { siteCount: output.length, licenseCount: marketplaceRows.length, hostnameMissingCount },
    sites: output
  }
}
