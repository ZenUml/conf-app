import { describe, it, expect, beforeEach, vi } from 'vitest'
import { decidePageBanner } from './pageBanner'
import { shouldShowPaywallBanner, deriveWarningBannerIdentity } from '@/utils/paywall/warningBanner'
import { isCurrentUserSpaceAdmin } from '@/utils/paywall/spaceAdminProbe'
import { isCsatPendingFresh } from '@/utils/csat'

const IDENTITY = { clientDomain: 'example-tenant', spaceKey: 'ENG' }

vi.mock('@/utils/paywall/warningBanner', () => ({
  shouldShowPaywallBanner: vi.fn(),
  deriveWarningBannerIdentity: vi.fn(),
}))
vi.mock('@/utils/paywall/spaceAdminProbe', () => ({ isCurrentUserSpaceAdmin: vi.fn() }))
vi.mock('@/utils/csat', () => ({ isCsatPendingFresh: vi.fn() }))

const paywall = vi.mocked(shouldShowPaywallBanner)
const csat = vi.mocked(isCsatPendingFresh)
const identity = vi.mocked(deriveWarningBannerIdentity)
const isAdmin = vi.mocked(isCurrentUserSpaceAdmin)

describe('decidePageBanner — central priority for page-banner slots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    identity.mockReturnValue(IDENTITY)
    isAdmin.mockReturnValue(false)
  })

  it('chooses paywall when the paywall warning is eligible', () => {
    paywall.mockReturnValue(true)
    csat.mockReturnValue(false)
    expect(decidePageBanner()).toBe('paywall')
  })

  it('paywall outranks CSAT when BOTH are eligible (no stacking, no defer needed)', () => {
    paywall.mockReturnValue(true)
    csat.mockReturnValue(true)
    expect(decidePageBanner()).toBe('paywall')
    // CSAT is never even consulted once paywall wins.
    expect(csat).not.toHaveBeenCalled()
  })

  it('falls back to CSAT when paywall is not eligible but a fresh CSAT trigger exists', () => {
    paywall.mockReturnValue(false)
    csat.mockReturnValue(true)
    expect(decidePageBanner()).toBe('csat')
  })

  it('chooses none when neither is eligible', () => {
    paywall.mockReturnValue(false)
    csat.mockReturnValue(false)
    expect(decidePageBanner()).toBe('none')
  })

  it('threads `now` to both predicates', () => {
    paywall.mockReturnValue(false)
    csat.mockReturnValue(false)
    decidePageBanner(1234)
    expect(paywall).toHaveBeenCalledWith(1234, IDENTITY, false)
    expect(csat).toHaveBeenCalledWith(1234)
  })

  // Phase 5b: without this the admin verdict is resolved but never reaches the
  // gate, and the banner silently stays author-only.
  it('threads the space-admin verdict to the paywall gate', () => {
    paywall.mockReturnValue(false)
    csat.mockReturnValue(false)
    isAdmin.mockReturnValue(true)
    decidePageBanner(1234)
    expect(paywall).toHaveBeenCalledWith(1234, IDENTITY, true)
  })
})
