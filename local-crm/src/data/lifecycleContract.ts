import type { AppKey } from './types'

export const LIFECYCLE_CONTRACT_VERSION = 1 as const

export interface LifecycleContactRecord {
  id: string
  email: string
  app: AppKey
  cloudId: string
  domain: string | null
  licenseType: string | null
  seatTier: string | null
  evalEndsAt: string | null
  step: string
  suppressed: boolean
  firstSeenAt: string
  lastSeenAt: string
}

export interface LifecyclePreview {
  app: AppKey
  subject: string
  html: string
}

export interface LifecycleResponse {
  contractVersion: typeof LIFECYCLE_CONTRACT_VERSION
  generatedAt: string
  source: {
    state: 'ok'
    marketplaceRows: number
    localDatabase: 'lifecycle.sqlite'
    detail: string
  }
  summary: {
    contacts: number
    tenants: number
    suppressed: number
    byStep: Record<string, number>
  }
  contacts: LifecycleContactRecord[]
  previews: LifecyclePreview[]
}
