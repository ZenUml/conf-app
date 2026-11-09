export const MARKETPLACE_UPGRADE_URL = 'https://marketplace.atlassian.com/apps/1218380/zenuml-sequence-diagram'
export const SUPPORT_EMAIL = 'support@zenuml.com'
export const SUPPORT_TICKET_URL = 'https://zenuml.atlassian.net/servicedesk/customer/portal/1/group/1/create/1'

export interface LicenseNoticeInput {
  productType: string | undefined
  /** forgeContext.license?.active, untrusted: only a real boolean `false` counts. */
  licenseActive: unknown
  environmentType: unknown
  /** localStorage `mockLicenseActive === 'false'` (see readMockLicenseInactive). */
  mockInactive: boolean
  flagEnabled: boolean
}

/**
 * Full variant only: show the "no active license" notice when Forge
 * explicitly reports the license inactive. Missing or non-boolean values mean
 * "unknown" and never show it. The mock override exists so staging, which has
 * no Forge license, can be tested; it is never honoured in production.
 */
export function shouldShowLicenseNotice(input: LicenseNoticeInput): boolean {
  if (input.productType !== 'full') return false
  if (!input.flagEnabled) return false
  const isProduction = String(input.environmentType ?? '').toLowerCase() === 'production'
  if (input.mockInactive && !isProduction) return true
  return input.licenseActive === false
}

export function readMockLicenseInactive(): boolean {
  try {
    return localStorage.getItem('mockLicenseActive') === 'false'
  } catch {
    return false
  }
}
