export const EXTENSIONS_CONTRACT_VERSION = 1 as const

export type ExtensionSourceName =
  | 'marketplace'
  | 'jsm'
  | 'space_license_kv'
  | 'extension_action_d1'

export interface ExtensionSourceStatus {
  state: 'ok' | 'error'
  records: number
  detail: string
}

export interface MarketplaceLicenseContext {
  app: 'lite' | 'full' | 'diagramly' | 'asyncapi' | 'unknown'
  licenseType: string | null
  status: string | null
  tier: string | null
  evaluationStartedAt: string | null
  evaluationEndsAt: string | null
}

export interface ExtensionCommentEvidence {
  state: 'known' | 'unknown'
  publicCommentCount: number | null
  requesterCommentCount: number | null
  lastCommentAt: string | null
  lastCommentAuthor: string | null
  lastCommentAuthorship: 'requester' | 'non_requester' | 'unknown'
  reason: string | null
}

export interface ExtensionRequestContext {
  ticketKey: string
  status: string | null
  requester: string | null
  requesterAccountId: string | null
  targetUserAccountId: string | null
  typedDomain: string | null
  typedSpace: string | null
  macroCount: number | null
  macrosLimit: number | null
  createdAt: string | null
  updatedAt: string | null
  matchedBy: 'ticket_key' | 'domain_space'
  comments: ExtensionCommentEvidence
}

export interface ExtensionActionAudit {
  action: 'initial' | 'feedback' | 'unknown'
  status: 'pending' | 'applied' | 'unknown'
  macroCount: number | null
  expiresAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface ExtensionHistoryEntry {
  kind: 'kv_record_created' | 'kv_record_updated' | 'extension_action'
  at: string | null
  label: string
  evidence: 'space_license_kv' | 'extension_action_d1'
}

export interface ExtensionGrantRecord {
  id: string
  cloudId: string
  domain: string | null
  spaceKey: string
  scope: 'user' | 'space'
  userAccountId: string | null
  storedStatus: 'active' | 'inactive' | 'unknown'
  status: 'active' | 'expired' | 'inactive' | 'unknown'
  statusDerivedAt: string
  activatedBy: string | null
  ticketKey: string | null
  createdAt: string | null
  updatedAt: string | null
  expiresAt: string | null
  marketplace: MarketplaceLicenseContext[]
  request: ExtensionRequestContext | null
  actionAudit: ExtensionActionAudit[]
  history: ExtensionHistoryEntry[]
  unknowns: string[]
}

export interface ExtensionOriginBucket {
  key: 'jsm_ticketed' | 'support_unticketed' | 'experiment' | 'other' | 'unknown'
  count: number
}

export interface ExtensionsResponse {
  contractVersion: typeof EXTENSIONS_CONTRACT_VERSION
  generatedAt: string
  asOf: string
  sources: Record<ExtensionSourceName, ExtensionSourceStatus>
  summary: {
    grantCount: number
    activeCount: number
    expiredCount: number
    inactiveCount: number
    unknownStatusCount: number
    tenantCount: number
    auditedGrantCount: number
    matchedRequestCount: number
    originBuckets: ExtensionOriginBucket[]
  }
  grants: ExtensionGrantRecord[]
}

export interface ExtensionDetailResponse {
  contractVersion: typeof EXTENSIONS_CONTRACT_VERSION
  generatedAt: string
  grant: ExtensionGrantRecord
}
