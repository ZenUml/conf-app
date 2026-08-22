import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { decidePageBanner, handlePageBannerRoute } from './pageBanner'
import { shouldShowPaywallBanner, deriveWarningBannerIdentity, readTargetingMarker } from '@/utils/paywall/warningBanner'
import { isCurrentUserSpaceAdmin } from '@/utils/paywall/spaceAdminProbe'
import { isCsatPendingFresh } from '@/utils/csat'
import { isInTemplateOfferBand, isTemplateOfferSuppressed } from '@/utils/template/templateOfferMarker'

const IDENTITY = { clientDomain: 'example-tenant', spaceKey: 'ENG' }

vi.mock('@/utils/paywall/warningBanner', () => ({
  shouldShowPaywallBanner: vi.fn(),
  deriveWarningBannerIdentity: vi.fn(),
  readTargetingMarker: vi.fn(),
}))
vi.mock('@/utils/paywall/spaceAdminProbe', () => ({ isCurrentUserSpaceAdmin: vi.fn() }))
vi.mock('@/utils/csat', () => ({ isCsatPendingFresh: vi.fn() }))
vi.mock('@/utils/template/templateOfferMarker', () => ({
  isInTemplateOfferBand: vi.fn(),
  isTemplateOfferSuppressed: vi.fn(),
}))
vi.mock('@/utils/paywall/adminBannerFlag', () => ({ isAdminBannerEnabled: vi.fn() }))
vi.mock('@/model/globals', () => ({
  default: { apWrapper: { initializeContext: vi.fn().mockResolvedValue(undefined) } },
}))
vi.mock('@/components/UpgradePrompt/PaywallWarningBanner.vue', () => ({ default: { name: 'PaywallBanner' } }))
vi.mock('@/components/CSAT/CsatBanner.vue', () => ({ default: { name: 'CsatBanner' } }))
vi.mock('@/components/UpgradePrompt/TemplateOfferBanner.vue', () => ({ default: { name: 'TemplateOfferBanner' } }))

// Capture the root props handed to createApp — that is how the audience reaches
// the component, and a silent drop would be invisible in a render assertion.
const mountSpy = vi.fn()
let createdWith: unknown
vi.mock('vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue')>()),
  createApp: (_c: unknown, props: unknown) => {
    createdWith = props
    return { mount: mountSpy }
  },
}))

const paywall = vi.mocked(shouldShowPaywallBanner)
const csat = vi.mocked(isCsatPendingFresh)
const identity = vi.mocked(deriveWarningBannerIdentity)
const isAdmin = vi.mocked(isCurrentUserSpaceAdmin)
const readTargeting = vi.mocked(readTargetingMarker)
const inTemplateBand = vi.mocked(isInTemplateOfferBand)
const templateSuppressed = vi.mocked(isTemplateOfferSuppressed)
const flag = vi.mocked((await import('@/utils/paywall/adminBannerFlag')).isAdminBannerEnabled)
const initializeContext = vi.mocked((await import('@/model/globals')).default.apWrapper.initializeContext)

afterEach(() => vi.unstubAllEnvs())

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
    paywall.mockImplementation((_now, _id, asAdmin) => asAdmin === true)
    csat.mockReturnValue(false)
    isAdmin.mockReturnValue(true)
    expect(decidePageBanner(1234)).toBe('paywall-admin')
    expect(paywall).toHaveBeenCalledWith(1234, IDENTITY, true)
  })

  // The distinction matters because only the admin-only impression is subject to
  // the Phase 5b flag; an author who is also an admin must keep the old path.
  it('reports plain paywall — not paywall-admin — when the author gate already passes', () => {
    paywall.mockReturnValue(true)
    csat.mockReturnValue(false)
    isAdmin.mockReturnValue(true)
    expect(decidePageBanner()).toBe('paywall')
  })

  it('does not consult the admin verdict at all when the author gate passes', () => {
    paywall.mockReturnValue(true)
    csat.mockReturnValue(false)
    decidePageBanner()
    expect(isAdmin).not.toHaveBeenCalled()
  })

  it('chooses none when the user is an admin but the space is not over the limit', () => {
    paywall.mockReturnValue(false)
    csat.mockReturnValue(false)
    isAdmin.mockReturnValue(true)
    expect(decidePageBanner()).toBe('none')
  })

  describe('template offer', () => {
    beforeEach(() => {
      vi.stubEnv('PRODUCT_TYPE', 'lite')
      paywall.mockReturnValue(false)
      csat.mockReturnValue(false)
      isAdmin.mockReturnValue(true)
      readTargeting.mockReturnValue({ macroCount: 60 } as any)
      inTemplateBand.mockReturnValue(true)
      templateSuppressed.mockReturnValue(false)
    })

    it('offers a template to a Lite admin in the seed band', () => {
      expect(decidePageBanner(1234)).toBe('template-offer')
      expect(inTemplateBand).toHaveBeenCalledWith(60)
    })

    it('never outranks an author paywall banner', () => {
      paywall.mockReturnValue(true)
      expect(decidePageBanner(1234)).toBe('paywall')
    })

    it('never outranks an admin paywall banner', () => {
      paywall.mockImplementation((_now, _identity, asAdmin) => asAdmin === true)
      expect(decidePageBanner(1234)).toBe('paywall-admin')
    })

    it('requires the space-admin verdict', () => {
      isAdmin.mockReturnValue(false)
      expect(decidePageBanner(1234)).toBe('none')
    })

    it('requires an in-band macro count', () => {
      inTemplateBand.mockReturnValue(false)
      expect(decidePageBanner(1234)).toBe('none')
    })

    it('respects created or dismissed suppression', () => {
      templateSuppressed.mockReturnValue(true)
      expect(decidePageBanner(1234)).toBe('none')
    })

    it('outranks CSAT', () => {
      csat.mockReturnValue(true)
      expect(decidePageBanner(1234)).toBe('template-offer')
    })

    it('is Lite-only', () => {
      vi.stubEnv('PRODUCT_TYPE', 'full')
      expect(decidePageBanner(1234)).toBe('none')
    })
  })
})

// The Phase 5b flag is the kill switch for an audience of ~5,021 people across
// 19 live tenants, so its OFF path is tested explicitly rather than assumed.
describe('handlePageBannerRoute — Phase 5b flag gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdWith = undefined
    document.body.innerHTML = '<div id="app"></div>'
    csat.mockReturnValue(false)
  })

  it('mounts the admin banner when the flag is on', async () => {
    flag.mockResolvedValue(true)
    await expect(handlePageBannerRoute('paywall-admin')).resolves.toBe('paywall-admin')
    expect(mountSpy).toHaveBeenCalledOnce()
    // The audience is handed to the component, never re-derived inside it.
    expect(createdWith).toEqual({ isSpaceAdmin: true })
  })

  it('drops the admin impression entirely when the flag is off', async () => {
    flag.mockResolvedValue(false)
    await expect(handlePageBannerRoute('paywall-admin')).resolves.toBe('none')
    expect(mountSpy).not.toHaveBeenCalled()
  })

  it('falls back to CSAT when the flag is off and a CSAT trigger is pending', async () => {
    flag.mockResolvedValue(false)
    csat.mockReturnValue(true)
    await expect(handlePageBannerRoute('paywall-admin', 999)).resolves.toBe('csat')
    expect(csat).toHaveBeenCalledWith(999)
    expect(mountSpy).toHaveBeenCalledOnce()
  })

  it('never consults the flag for the pre-Phase-5b author banner', async () => {
    await expect(handlePageBannerRoute('paywall')).resolves.toBe('paywall')
    expect(flag).not.toHaveBeenCalled()
    expect(createdWith).toBeUndefined()
  })

  it('never consults the flag for CSAT', async () => {
    await expect(handlePageBannerRoute('csat')).resolves.toBe('csat')
    expect(flag).not.toHaveBeenCalled()
  })

  it('mounts the template offer with the targeted macro count', async () => {
    identity.mockReturnValue(IDENTITY)
    readTargeting.mockReturnValue({ macroCount: 60 } as any)

    await expect(handlePageBannerRoute('template-offer')).resolves.toBe('template-offer')
    expect(createdWith).toEqual({ macroCount: 60 })
    expect(flag).not.toHaveBeenCalled()
  })

  it('keeps the qualifying macro count when another iframe updates the marker during mount', async () => {
    identity.mockReturnValue(IDENTITY)
    readTargeting.mockReturnValue({ macroCount: 60 } as any)
    initializeContext.mockImplementationOnce(async () => {
      readTargeting.mockReturnValue({ macroCount: 8014 } as any)
    })

    await expect(handlePageBannerRoute('template-offer')).resolves.toBe('template-offer')
    expect(createdWith).toEqual({ macroCount: 60 })
  })
})
