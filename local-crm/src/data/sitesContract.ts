import type { AppKey } from './types'

export const SITES_CONTRACT_VERSION = 1 as const

export interface MarketplaceSiteRecord {
  cloudId: string
  domain: string | null
  apps: AppKey[]
  licenseRows: number
}

export interface SitesResponse {
  contractVersion: typeof SITES_CONTRACT_VERSION
  generatedAt: string
  source: { state: 'ok'; records: number; detail: string }
  summary: { siteCount: number; licenseCount: number; hostnameMissingCount: number }
  sites: MarketplaceSiteRecord[]
}
