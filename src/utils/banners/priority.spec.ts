import { describe, it, expect, beforeEach, vi } from 'vitest'
import { higherPriorityBannerPending } from './priority'
import { shouldShowPaywallBanner, deriveWarningBannerIdentity } from '@/utils/paywall/warningBanner'
import { isCurrentUserSpaceAdmin } from '@/utils/paywall/spaceAdminProbe'
import { isCsatPendingFresh } from '@/utils/csat'

vi.mock('@/utils/paywall/warningBanner', () => ({
  shouldShowPaywallBanner: vi.fn(),
  deriveWarningBannerIdentity: vi.fn(),
}))
vi.mock('@/utils/paywall/spaceAdminProbe', () => ({ isCurrentUserSpaceAdmin: vi.fn() }))
vi.mock('@/utils/csat', () => ({ isCsatPendingFresh: vi.fn() }))

const IDENTITY = { clientDomain: 'example-tenant', spaceKey: 'ENG' }
const paywall = vi.mocked(shouldShowPaywallBanner)
const csat = vi.mocked(isCsatPendingFresh)
const isAdmin = vi.mocked(isCurrentUserSpaceAdmin)

describe('higherPriorityBannerPending — the order both banner iframes obey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(deriveWarningBannerIdentity).mockReturnValue(IDENTITY)
    paywall.mockReturnValue(false)
    csat.mockReturnValue(false)
    isAdmin.mockReturnValue(false)
  })

  it('is null when the page is free — the unplaced notice may take it', () => {
    expect(higherPriorityBannerPending()).toBeNull()
  })

  it('names the paywall author banner', () => {
    paywall.mockImplementation((_now, _id, asAdmin) => asAdmin === false)
    expect(higherPriorityBannerPending()).toBe('paywall')
  })

  it('names the admin banner, and only when the user is an admin', () => {
    paywall.mockImplementation((_now, _id, asAdmin) => asAdmin === true)
    expect(higherPriorityBannerPending()).toBeNull()
    isAdmin.mockReturnValue(true)
    expect(higherPriorityBannerPending()).toBe('paywall-admin')
  })

  it('names CSAT', () => {
    csat.mockReturnValue(true)
    expect(higherPriorityBannerPending()).toBe('csat')
  })

  it('puts the paywall above CSAT', () => {
    paywall.mockReturnValue(true)
    csat.mockReturnValue(true)
    expect(higherPriorityBannerPending()).toBe('paywall')
    expect(csat).not.toHaveBeenCalled()
  })

  it('threads `now` through, so both iframes judge the same instant', () => {
    higherPriorityBannerPending(1234)
    expect(paywall).toHaveBeenCalledWith(1234, IDENTITY, false)
    expect(csat).toHaveBeenCalledWith(1234)
  })

  it('reads only synchronous state — no await, no request', () => {
    // This is what makes it safe across two iframes that cannot talk: they are
    // not coordinating, they are reading the same facts.
    expect(higherPriorityBannerPending()).not.toBeInstanceOf(Promise)
  })
})
