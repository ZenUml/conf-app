import type { SiteRow, SiteStat } from '@/lib/derive'
import { human } from '@/lib/format'
import type { Dataset } from './types'
import { SITES_CONTRACT_VERSION, type SitesResponse } from './sitesContract'
import type { LifecycleResponse } from './lifecycleContract'

export const MARKETPLACE_TECHNICAL_CONTACT_LABEL = 'Marketplace technical contact — not a confirmed Site Contact'

export interface SitesLoadState {
  state: 'loading' | 'live' | 'error'
  generatedAt: string | null
  summary: SitesResponse['summary'] | null
  error: string | null
}

export const INITIAL_SITES_LOAD: SitesLoadState = {
  state: 'loading', generatedAt: null, summary: null, error: null
}

function appOrder(left: SiteRow['apps'][number], right: SiteRow['apps'][number]): number {
  return ['full', 'lite', 'dia', 'api'].indexOf(left) - ['full', 'lite', 'dia', 'api'].indexOf(right)
}

export function sitesFromResponse(
  response: SitesResponse,
  extensions: Dataset,
  lifecycle?: Pick<LifecycleResponse, 'contacts'> | null
): SiteRow[] {
  const grants = new Map<string, { total: number; active: number }>()
  for (const grant of extensions.grants) {
    if (!grant.cloudId) continue
    const existing = grants.get(grant.cloudId) ?? { total: 0, active: 0 }
    existing.total++
    if (grant.status === 'active') existing.active++
    grants.set(grant.cloudId, existing)
  }
  const contactsByCloudId = new Map<string, string[]>()
  for (const contact of lifecycle?.contacts ?? []) {
    if (!contact.cloudId || !contact.email) continue
    const contacts = contactsByCloudId.get(contact.cloudId) ?? []
    if (!contacts.includes(contact.email)) contacts.push(contact.email)
    contactsByCloudId.set(contact.cloudId, contacts)
  }
  const observed = human(response.generatedAt.slice(0, 10))
  return response.sites.map(site => {
    const extension = grants.get(site.cloudId)
    return {
      domain: site.domain ?? `(hostname unavailable · cloud ${site.cloudId.slice(0, 8)})`,
      cloudId: site.cloudId,
      cloudIdMissing: false,
      apps: [...site.apps].sort(appOrder),
      extensions: extension ? `${extension.total} ${extension.total === 1 ? 'grant' : 'grants'} · ${extension.active} active` : '—',
      last: `Marketplace read ${observed}`,
      technicalContacts: [...(contactsByCloudId.get(site.cloudId) ?? [])].sort()
    }
  })
}

export function siteStatsFromResponse(response: SitesResponse, sites: SiteRow[], extensions: Dataset): SiteStat[] {
  const grantHolders = new Set(extensions.grants.filter(grant => grant.cloudId).map(grant => grant.cloudId))
  return [
    { label: 'Marketplace sites', value: sites.length, tone: 'plain' },
    { label: 'licence rows', value: response.summary.licenseCount, tone: 'brand' },
    { label: 'hold an extension', value: grantHolders.size, tone: 'plain' },
    { label: 'hostname unavailable', value: response.summary.hostnameMissingCount, tone: 'rust' }
  ]
}

export async function loadSitesResponse(): Promise<SitesResponse> {
  const response = await fetch('/api/local-crm/sites', { headers: { accept: 'application/json' }, cache: 'no-store' })
  const body = await response.json() as SitesResponse | { detail?: string }
  if (!response.ok) throw new Error('detail' in body && body.detail ? body.detail : `Sites API returned ${response.status}`)
  if (!('contractVersion' in body) || body.contractVersion !== SITES_CONTRACT_VERSION) {
    throw new Error('Sites API contract version is unsupported')
  }
  return body
}
