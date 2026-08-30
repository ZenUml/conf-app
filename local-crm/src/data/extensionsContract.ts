export const EXTENSIONS_CONTRACT_VERSION = 3 as const

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
  /** First non-empty line only. Full comment bodies never cross the loopback contract. */
  lastCommentFirstLine: string | null
  reason: string | null
  unavailableReasons: Record<string, string>
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
  /** Verbatim non-empty JSM form values, before numeric conversion. */
  macroCountRaw: string | null
  macrosLimitRaw: string | null
  createdAt: string | null
  updatedAt: string | null
  matchedBy: 'ticket_key' | 'domain_space'
  comments: ExtensionCommentEvidence
  unavailableReasons: Record<string, string>
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
  unavailableReasons: Record<string, string>
}

export interface ExtensionOriginBucket {
  key: 'jsm_ticketed' | 'support_unticketed' | 'experiment' | 'other' | 'unknown'
  count: number
}

/**
 * An open request returned by the dedicated JSM search window. A missing
 * exact ticket match says only that this KV snapshot does not currently
 * observe a grant for that request; it does not imply rejection or denial.
 */
/** What one prior grant history says about the space a request names. */
export interface PriorGrantSummary {
  count: number | null
  activeCount: number | null
  latestExpiresAt: string | null
  unavailableReason: string | null
}

export interface OpenExtensionRequest {
  ticketKey: string
  status: string | null
  createdAt: string | null
  updatedAt: string | null
  typedDomain: string | null
  typedSpace: string | null
  currentGrant: 'observed' | 'not_observed' | 'insufficient'
  /** Resolved from the Marketplace rows by typed domain; null when no site matches. */
  cloudId: string | null
  requester: string | null
  /** As the requester typed it into the JSM form, against the plan's own limit. */
  macroCount: number | null
  macrosLimit: number | null
  macroCountRaw: string | null
  macrosLimitRaw: string | null
  /** Current KV grants for the same cloud ID and space, so a repeat ask is visible. */
  priorGrants: PriorGrantSummary
  comments: ExtensionCommentEvidence
  unavailableReasons: Record<string, string>
}

export interface OpenExtensionRequestStream {
  /** Complete means JSM and KV both returned, within the documented fetch limit. */
  state: 'complete' | 'truncated' | 'unavailable'
  detail: string
  rows: OpenExtensionRequest[]
  summary: {
    currentGrantObserved: number
    noCurrentGrantObserved: number
    insufficientEvidence: number
  }
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
  openRequests: OpenExtensionRequestStream
}

export interface ExtensionDetailResponse {
  contractVersion: typeof EXTENSIONS_CONTRACT_VERSION
  generatedAt: string
  grant: ExtensionGrantRecord
}
