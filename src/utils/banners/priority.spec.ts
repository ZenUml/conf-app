import { describe, it, expect, beforeEach, vi } from 'vitest'
import { higherPriorityBannerPending } from './priority'
import { shouldShowPaywallBanner, deriveWarningBannerIdentity, readTargetingMarker } from '@/utils/paywall/warningBanner'
import { isCurrentUserSpaceAdmin } from '@/utils/paywall/spaceAdminProbe'
import { isCsatPendingFresh, isCsatSuppressed } from '@/utils/csat'
import { isInTemplateOfferBand, isTemplateOfferSuppressed } from '@/utils/template/templateOfferMarker'

vi.mock('@/utils/paywall/warningBanner', () => ({
  shouldShowPaywallBanner: vi.fn(),
  deriveWarningBannerIdentity: vi.fn(),
  readTargetingMarker: vi.fn(),
}))
vi.mock('@/utils/paywall/spaceAdminProbe', () => ({ isCurrentUserSpaceAdmin: vi.fn() }))
vi.mock('@/utils/csat', () => ({ isCsatPendingFresh: vi.fn(), isCsatSuppressed: vi.fn() }))
vi.mock('@/utils/template/templateOfferMarker', () => ({
  isInTemplateOfferBand: vi.fn(),
  isTemplateOfferSuppressed: vi.fn(),
}))

const IDENTITY = { clientDomain: 'example-tenant', spaceKey: 'ENG' }
const paywall = vi.mocked(shouldShowPaywallBanner)
const csat = vi.mocked(isCsatPendingFresh)
const csatSuppressed = vi.mocked(isCsatSuppressed)
const isAdmin = vi.mocked(isCurrentUserSpaceAdmin)
const targeting = vi.mocked(readTargetingMarker)
const inTemplateBand = vi.mocked(isInTemplateOfferBand)
const templateSuppressed = vi.mocked(isTemplateOfferSuppressed)

describe('higherPriorityBannerPending — the order both banner iframes obey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(deriveWarningBannerIdentity).mockReturnValue(IDENTITY)
    paywall.mockReturnValue(false)
    csat.mockReturnValue(false)
    csatSuppressed.mockReturnValue(false)
    isAdmin.mockReturnValue(false)
    targeting.mockReturnValue(null)
    inTemplateBand.mockReturnValue(false)
    templateSuppressed.mockReturnValue(false)
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

  it('does NOT yield to an armed trigger the survey is not eligible to answer', () => {
    // The bug this guards: a user who dismissed CSAT in the past week keeps the
    // suppression record for 7 days, while every save re-arms csatPending for
    // 10 minutes. Yielding on the trigger alone left BOTH banners closed —
    // CsatBanner mounts, re-reads the same record, and closes itself.
    csat.mockReturnValue(true)
    csatSuppressed.mockReturnValue(true)
    expect(higherPriorityBannerPending()).toBeNull()
  })

  it('still yields when the trigger is armed and the survey is eligible', () => {
    csat.mockReturnValue(true)
    csatSuppressed.mockReturnValue(false)
    expect(higherPriorityBannerPending()).toBe('csat')
  })

  it('names the eligible Lite template offer so the property-gated unplaced banner yields', () => {
    // This dedicated pageBanner module bypasses the shared host. A null here
    // would let its unplaced notice stack below the template offer.
    vi.stubEnv('PRODUCT_TYPE', 'lite')
    isAdmin.mockReturnValue(true)
    targeting.mockReturnValue({ macroCount: 60 } as any)
    inTemplateBand.mockReturnValue(true)

    expect(higherPriorityBannerPending()).toBe('template-offer')
  })

  it('does not pay the suppression read when no trigger is armed', () => {
    csat.mockReturnValue(false)
    expect(higherPriorityBannerPending()).toBeNull()
    expect(csatSuppressed).not.toHaveBeenCalled()
  })

  it('threads `now` through, so both iframes judge the same instant', () => {
    csat.mockReturnValue(true)
    higherPriorityBannerPending(1234)
    expect(paywall).toHaveBeenCalledWith(1234, IDENTITY, false)
    expect(csat).toHaveBeenCalledWith(1234)
    expect(csatSuppressed).toHaveBeenCalledWith(1234)
  })

  it('reads only synchronous state — no await, no request', () => {
    // This is what makes it safe across two iframes that cannot talk: they are
    // not coordinating, they are reading the same facts.
    expect(higherPriorityBannerPending()).not.toBeInstanceOf(Promise)
  })
})
