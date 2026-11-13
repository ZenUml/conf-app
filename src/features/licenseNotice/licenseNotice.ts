export const MARKETPLACE_UPGRADE_URL = 'https://marketplace.atlassian.com/apps/1218380/zenuml-sequence-diagram'
export const SUPPORT_EMAIL = 'support@zenuml.com'
export const SUPPORT_TICKET_URL = 'https://zenuml.atlassian.net/servicedesk/customer/portal/1/group/1/create/1'

export type LicenseNoticeBasis = 'forge_inactive' | 'forge_legacy_free' | 'marketplace_legacy_free' | 'development_mock'
export interface LicenseNoticeInput {
  productType: string | undefined
  licenseActive: unknown
  licenseType?: unknown
  environmentType: unknown
  mockInactive: boolean
  flagEnabled: boolean
  /** Only supplied by the FIT-authenticated /api/license-notice response. */
  marketplaceEvidence?: unknown
}

// Keep equal to MAX_VALIDITY_MS in functions/api/license-notice.ts.
const MAX_EVIDENCE_AGE_MS = 7 * 24 * 60 * 60 * 1000

function hasFreshMarketplaceEvidence(value: unknown, now: number): boolean {
  if (!value || typeof value !== 'object') return false
  const evidence = value as Record<string, unknown>
  if (evidence.state !== 'legacy_free' || typeof evidence.checkedAt !== 'string' || typeof evidence.expiresAt !== 'string') return false
  const checkedAt = Date.parse(evidence.checkedAt)
  const expiresAt = Date.parse(evidence.expiresAt)
  return Number.isFinite(checkedAt) && Number.isFinite(expiresAt)
    && checkedAt <= now && now < expiresAt && expiresAt > checkedAt
    && expiresAt - checkedAt <= MAX_EVIDENCE_AGE_MS
}

/** Missing/malformed license fields are unknown, never an inactive license.
 * Legacy Free needs either its explicit Forge type or fresh Marketplace evidence.
 * A currently active Forge license always wins over historical evidence.
 */
export function licenseNoticeBasis(input: LicenseNoticeInput, now = Date.now()): LicenseNoticeBasis | null {
  if (input.productType !== 'full' || !input.flagEnabled) return null
  const isProduction = String(input.environmentType ?? '').toLowerCase() === 'production'
  if (input.mockInactive && !isProduction) return 'development_mock'
  if (input.licenseActive === true) return null
  if (input.licenseActive === false) return 'forge_inactive'
  if (input.licenseActive != null) return null
  if (input.licenseType === 'LEGACY_FREE') return 'forge_legacy_free'
  if (hasFreshMarketplaceEvidence(input.marketplaceEvidence, now)) return 'marketplace_legacy_free'
  return null
}

export function shouldShowLicenseNotice(input: LicenseNoticeInput): boolean {
  return licenseNoticeBasis(input) !== null
}

export interface LicenseNoticeDecision {
  basis: LicenseNoticeBasis | null
  outcome: 'shown' | 'active' | 'unknown' | 'disabled' | 'unavailable'
  expiresAt?: string
}

export async function resolveLicenseNotice(
  input: LicenseNoticeInput,
  loadEvidence: () => Promise<unknown>,
  now = Date.now(),
): Promise<LicenseNoticeDecision> {
  const basis = licenseNoticeBasis(input, now)
  if (basis) return { basis, outcome: 'shown' }
  if (input.productType !== 'full' || !input.flagEnabled) return { basis: null, outcome: 'disabled' }
  if (input.licenseActive === true) return { basis: null, outcome: 'active' }
  if (input.licenseActive != null) return { basis: null, outcome: 'unknown' }
  const startedAt = Date.now()
  try {
    const marketplaceEvidence = await loadEvidence()
    // Do not let a slow request use a stale clock when validating its evidence.
    const resolvedBasis = licenseNoticeBasis({ ...input, marketplaceEvidence }, now + Math.max(0, Date.now() - startedAt))
    return { basis: resolvedBasis, outcome: resolvedBasis ? 'shown' : 'unknown',
      ...(resolvedBasis === 'marketplace_legacy_free' ? { expiresAt: (marketplaceEvidence as { expiresAt: string }).expiresAt } : {}),
    }
  } catch {
    return { basis: null, outcome: 'unavailable' }
  }
}

export function readMockLicenseInactive(): boolean {
  try {
    return localStorage.getItem('mockLicenseActive') === 'false'
  } catch {
    return false
  }
}
