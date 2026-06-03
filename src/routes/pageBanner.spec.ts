import { describe, it, expect, beforeEach, vi } from 'vitest'
import { decidePageBanner } from './pageBanner'
import { shouldShowPaywallBanner } from '@/utils/paywall/warningBanner'
import { isCsatPendingFresh } from '@/utils/csat'

vi.mock('@/utils/paywall/warningBanner', () => ({ shouldShowPaywallBanner: vi.fn() }))
vi.mock('@/utils/csat', () => ({ isCsatPendingFresh: vi.fn() }))

const paywall = vi.mocked(shouldShowPaywallBanner)
const csat = vi.mocked(isCsatPendingFresh)

describe('decidePageBanner — central priority for page-banner slots', () => {
  beforeEach(() => vi.clearAllMocks())

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
    expect(paywall).toHaveBeenCalledWith(1234)
    expect(csat).toHaveBeenCalledWith(1234)
  })
})
