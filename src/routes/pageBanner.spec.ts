import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { decidePageBanner, handlePageBannerRoute, maybeHandleTargetedSurvey } from './pageBanner'
import { shouldShowPaywallBanner, deriveWarningBannerIdentity, readTargetingMarker } from '@/utils/paywall/warningBanner'
import { isCurrentUserSpaceAdmin } from '@/utils/paywall/spaceAdminProbe'
import { isCsatPendingFresh, isCsatSuppressed } from '@/utils/csat'
import { isInTemplateOfferBand, isTemplateOfferSuppressed } from '@/utils/template/templateOfferMarker'

const IDENTITY = { clientDomain: 'example-tenant', spaceKey: 'ENG' }

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
vi.mock('@/utils/byline/unplacedMarker', () => ({
  deriveUnplacedIdentity: vi.fn(),
  isUnplacedBannerCandidate: vi.fn(),
}))
vi.mock('@/model/globals', () => ({
  default: { apWrapper: { initializeContext: vi.fn().mockResolvedValue(undefined) } },
}))
vi.mock('@/components/UpgradePrompt/PaywallWarningBanner.vue', () => ({ default: { name: 'PaywallBanner' } }))
vi.mock('@/components/UpgradePrompt/TemplateOfferBanner.vue', () => ({ default: { name: 'TemplateOfferBanner' } }))
vi.mock('@/components/CSAT/CsatBanner.vue', () => ({ default: { name: 'CsatBanner' } }))
vi.mock('@/components/Byline/UnplacedDiagramsBanner.vue', () => ({ default: { name: 'UnplacedBanner' } }))
vi.mock('@/components/WhatsNew/WhatsNewBanner.vue', () => ({ default: { name: 'WhatsNewBanner' } }))
vi.mock('@/utils/whatsNew/state', () => ({ whatsNewCandidate: vi.fn() }))
const viewClose = vi.fn()
vi.mock('@forge/bridge', () => ({ view: { close: () => viewClose() } }))
vi.mock('@/components/TargetedSurvey/TargetedSurveyBanner.vue', () => ({ default: { name: 'TargetedSurveyBanner' } }))
vi.mock('@/features/targetedSurvey/survey', () => ({ loadTargetedSurvey: vi.fn() }))

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
const csatSuppressed = vi.mocked(isCsatSuppressed)
const identity = vi.mocked(deriveWarningBannerIdentity)
const isAdmin = vi.mocked(isCurrentUserSpaceAdmin)
const readTargeting = vi.mocked(readTargetingMarker)
const inTemplateBand = vi.mocked(isInTemplateOfferBand)
const templateSuppressed = vi.mocked(isTemplateOfferSuppressed)
const unplacedMarker = await import('@/utils/byline/unplacedMarker')
const unplaced = vi.mocked(unplacedMarker.isUnplacedBannerCandidate)
const unplacedIdentity = vi.mocked(unplacedMarker.deriveUnplacedIdentity)
const UNPLACED_IDENTITY = { clientDomain: 'example-tenant', pageId: 'page-1' }
const whatsNew = vi.mocked((await import('@/utils/whatsNew/state')).whatsNewCandidate)
const RELEASE = {
  id: '2026-10',
  publishedAt: '2026-10-01',
  headline: 'Two new things',
  items: [{ id: 'a', title: 'A', body: 'Body A' }],
}
const loadSurvey = vi.mocked((await import('@/features/targetedSurvey/survey')).loadTargetedSurvey)
const initializeContext = vi.mocked((await import('@/model/globals')).default.apWrapper.initializeContext)

afterEach(() => vi.unstubAllEnvs())

describe('decidePageBanner — central priority for page-banner slots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    identity.mockReturnValue(IDENTITY)
    csatSuppressed.mockReturnValue(false)
    isAdmin.mockReturnValue(false)
    readTargeting.mockReturnValue(null)
    inTemplateBand.mockReturnValue(false)
    templateSuppressed.mockReturnValue(false)
    unplaced.mockReturnValue(false)
    unplacedIdentity.mockReturnValue(UNPLACED_IDENTITY)
    whatsNew.mockReturnValue(null)
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

  it('does not spend the slot on a CSAT trigger the user has suppressed', () => {
    // Handing the slot to CsatBanner here wastes it: the component re-reads the
    // same suppression record on mount and closes itself, so the unplaced
    // notice that WOULD have shown never gets its turn.
    paywall.mockReturnValue(false)
    csat.mockReturnValue(true)
    csatSuppressed.mockReturnValue(true)
    unplaced.mockReturnValue(true)
    expect(decidePageBanner()).toBe('unplaced')
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

  // The author gate remains the first route even when the user is also an admin.
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

  it('falls through to the unplaced-diagram notice when nothing else is eligible', () => {
    paywall.mockReturnValue(false)
    csat.mockReturnValue(false)
    unplaced.mockReturnValue(true)
    expect(decidePageBanner(1234)).toBe('unplaced')
    expect(unplaced).toHaveBeenCalledWith(UNPLACED_IDENTITY, 1234)
  })

  it('keeps the unplaced notice BELOW the paywall warning and CSAT', () => {
    // It is the only one of the three that keeps: the diagram is still saved
    // and still unplaced tomorrow, and the banner re-arms itself. A CSAT
    // trigger's window closes, and a paywall block is happening right now.
    paywall.mockReturnValue(false)
    csat.mockReturnValue(true)
    unplaced.mockReturnValue(true)
    expect(decidePageBanner()).toBe('csat')

    paywall.mockReturnValue(true)
    expect(decidePageBanner()).toBe('paywall')
  })

  it('never even reads the marker while a higher banner is eligible', () => {
    paywall.mockReturnValue(true)
    expect(decidePageBanner()).toBe('paywall')
    expect(unplaced).not.toHaveBeenCalled()
  })

  describe('Lite template offer', () => {
    beforeEach(() => {
      vi.stubEnv('PRODUCT_TYPE', 'lite')
      paywall.mockReturnValue(false)
      csat.mockReturnValue(false)
      isAdmin.mockReturnValue(true)
      readTargeting.mockReturnValue({ macroCount: 60 } as any)
      inTemplateBand.mockReturnValue(true)
      templateSuppressed.mockReturnValue(false)
    })

    it('takes the slot before CSAT, unplaced, and What’s new', () => {
      csat.mockReturnValue(true)
      unplaced.mockReturnValue(true)
      whatsNew.mockReturnValue(RELEASE)
      expect(decidePageBanner(1234)).toBe('template-offer')
      expect(inTemplateBand).toHaveBeenCalledWith(60)
    })

    it('yields to the paywall', () => {
      paywall.mockReturnValue(true)
      expect(decidePageBanner()).toBe('paywall')
    })

    it('requires an admin, in-band count, and no suppression', () => {
      isAdmin.mockReturnValue(false)
      expect(decidePageBanner()).toBe('none')
      isAdmin.mockReturnValue(true)
      inTemplateBand.mockReturnValue(false)
      expect(decidePageBanner()).toBe('none')
      inTemplateBand.mockReturnValue(true)
      templateSuppressed.mockReturnValue(true)
      expect(decidePageBanner()).toBe('none')
    })

    it('does not appear outside Lite', () => {
      vi.stubEnv('PRODUCT_TYPE', 'full')
      expect(decidePageBanner()).toBe('none')
    })
  })
})

describe('page-banner targeted survey fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = '<div id="app"></div>'
    identity.mockReturnValue(IDENTITY)
    isAdmin.mockReturnValue(false)
    paywall.mockReturnValue(false)
    csat.mockReturnValue(false)
    unplaced.mockReturnValue(false)
    unplacedIdentity.mockReturnValue(UNPLACED_IDENTITY)
    whatsNew.mockReturnValue(null)
    loadSurvey.mockResolvedValue({ survey: {
      uuid: '71861d63-dc0b-4a75-8a04-724711577d70', revision: 1,
      expiresAt: '2099-01-01T00:00:00.000Z', title: 'Help us improve ZenUML',
      question: 'What could we improve?', options: [{ id: 'editing', label: 'Editing diagrams' }],
    }, terminalKey: 'synthetic-key' })
  })

  it.each(['lite', 'full'])('mounts the fallback in %s after existing banners decline', async (product) => {
    expect(decidePageBanner()).toBe('none')
    expect(await maybeHandleTargetedSurvey(product)).toBe(true)
    expect(loadSurvey).toHaveBeenCalledOnce()
    expect(mountSpy).toHaveBeenCalledOnce()
    expect(createdWith).toMatchObject({ terminalKey: 'synthetic-key' })
  })

  it('never loads it in Diagramly', async () => {
    expect(await maybeHandleTargetedSurvey('diagramly')).toBe(false)
    expect(loadSurvey).not.toHaveBeenCalled()
  })
})

describe('handlePageBannerRoute — paywall audiences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdWith = undefined
    document.body.innerHTML = '<div id="app"></div>'
    csat.mockReturnValue(false)
    unplaced.mockReturnValue(false)
    unplacedIdentity.mockReturnValue(UNPLACED_IDENTITY)
  })

  it('mounts the admin banner with the space-admin audience', async () => {
    await expect(handlePageBannerRoute('paywall-admin')).resolves.toBe('paywall-admin')
    expect(mountSpy).toHaveBeenCalledOnce()
    // The audience is handed to the component, never re-derived inside it.
    expect(createdWith).toEqual({ isSpaceAdmin: true })
  })

  it('mounts the author banner without space-admin props', async () => {
    await expect(handlePageBannerRoute('paywall')).resolves.toBe('paywall')
    expect(createdWith).toBeUndefined()
  })

  it('mounts the template offer with the count that admitted it', async () => {
    vi.mocked(deriveWarningBannerIdentity).mockReturnValue(IDENTITY)
    readTargeting.mockReturnValue({ macroCount: 60 } as any)
    initializeContext.mockImplementationOnce(async () => {
      readTargeting.mockReturnValue({ macroCount: 8014 } as any)
    })
    await expect(handlePageBannerRoute('template-offer')).resolves.toBe('template-offer')
    expect(createdWith).toEqual({ macroCount: 60 })
  })

  it('tells the unplaced banner which store admitted it', async () => {
    // Re-deriving this inside the component would cost a property read on the
    // one path that has no property.
    await expect(handlePageBannerRoute('unplaced')).resolves.toBe('unplaced')
    expect(mountSpy).toHaveBeenCalledOnce()
    expect(createdWith).toEqual({ source: 'marker' })
  })

  it('mounts the same component for the gated module, reading the page property', async () => {
    await expect(handlePageBannerRoute('unplaced-property')).resolves.toBe('unplaced-property')
    expect(mountSpy).toHaveBeenCalledOnce()
    expect(createdWith).toEqual({ source: 'property' })
  })
})

describe('"What\'s new" — lowest-priority page-banner slot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdWith = undefined
    document.body.innerHTML = '<div id="app"></div>'
    identity.mockReturnValue(IDENTITY)
    paywall.mockReturnValue(false)
    isAdmin.mockReturnValue(false)
    csat.mockReturnValue(false)
    csatSuppressed.mockReturnValue(false)
    unplaced.mockReturnValue(false)
    unplacedIdentity.mockReturnValue(UNPLACED_IDENTITY)
    whatsNew.mockReturnValue(null)
  })

  it('takes the slot when nothing else wants it', () => {
    whatsNew.mockReturnValue(RELEASE)
    expect(decidePageBanner(1234)).toBe('whats-new')
    expect(whatsNew).toHaveBeenCalledWith(1234)
  })

  it('stays none when there is no candidate release', () => {
    expect(decidePageBanner()).toBe('none')
  })

  it('yields to every other banner', () => {
    whatsNew.mockReturnValue(RELEASE)
    unplaced.mockReturnValue(true)
    expect(decidePageBanner()).toBe('unplaced')
    csat.mockReturnValue(true)
    expect(decidePageBanner()).toBe('csat')
    paywall.mockReturnValue(true)
    expect(decidePageBanner()).toBe('paywall')
  })

  it('is not even consulted when a higher banner wins', () => {
    paywall.mockReturnValue(true)
    decidePageBanner()
    expect(whatsNew).not.toHaveBeenCalled()
  })

  it('hands the release to the component', async () => {
    whatsNew.mockReturnValue(RELEASE)
    await expect(handlePageBannerRoute('whats-new', 1234)).resolves.toBe('whats-new')
    expect(mountSpy).toHaveBeenCalledOnce()
    expect(createdWith).toEqual({ release: RELEASE })
    expect(viewClose).not.toHaveBeenCalled()
  })

  it('closes instead of mounting an empty strip if the release lapsed', async () => {
    await expect(handlePageBannerRoute('whats-new')).resolves.toBe('none')
    expect(mountSpy).not.toHaveBeenCalled()
    expect(viewClose).toHaveBeenCalledOnce()
  })
})
