import { describe, it, expect, beforeEach, vi } from 'vitest'
import { decidePageBanner, handlePageBannerRoute } from './pageBanner'
import { shouldShowPaywallBanner, deriveWarningBannerIdentity } from '@/utils/paywall/warningBanner'
import { isCurrentUserSpaceAdmin } from '@/utils/paywall/spaceAdminProbe'
import { isCsatPendingFresh, isCsatSuppressed } from '@/utils/csat'

const IDENTITY = { clientDomain: 'example-tenant', spaceKey: 'ENG' }

vi.mock('@/utils/paywall/warningBanner', () => ({
  shouldShowPaywallBanner: vi.fn(),
  deriveWarningBannerIdentity: vi.fn(),
}))
vi.mock('@/utils/paywall/spaceAdminProbe', () => ({ isCurrentUserSpaceAdmin: vi.fn() }))
vi.mock('@/utils/csat', () => ({ isCsatPendingFresh: vi.fn(), isCsatSuppressed: vi.fn() }))
vi.mock('@/utils/byline/unplacedMarker', () => ({
  deriveUnplacedIdentity: vi.fn(),
  isUnplacedBannerCandidate: vi.fn(),
}))
vi.mock('@/utils/paywall/adminBannerFlag', () => ({ isAdminBannerEnabled: vi.fn() }))
vi.mock('@/model/globals', () => ({
  default: { apWrapper: { initializeContext: vi.fn().mockResolvedValue(undefined) } },
}))
vi.mock('@/components/UpgradePrompt/PaywallWarningBanner.vue', () => ({ default: { name: 'PaywallBanner' } }))
vi.mock('@/components/CSAT/CsatBanner.vue', () => ({ default: { name: 'CsatBanner' } }))
vi.mock('@/components/Byline/UnplacedDiagramsBanner.vue', () => ({ default: { name: 'UnplacedBanner' } }))

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
const flag = vi.mocked((await import('@/utils/paywall/adminBannerFlag')).isAdminBannerEnabled)
const unplacedMarker = await import('@/utils/byline/unplacedMarker')
const unplaced = vi.mocked(unplacedMarker.isUnplacedBannerCandidate)
const unplacedIdentity = vi.mocked(unplacedMarker.deriveUnplacedIdentity)
const UNPLACED_IDENTITY = { clientDomain: 'example-tenant', pageId: 'page-1' }

describe('decidePageBanner — central priority for page-banner slots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    identity.mockReturnValue(IDENTITY)
    csatSuppressed.mockReturnValue(false)
    isAdmin.mockReturnValue(false)
    unplaced.mockReturnValue(false)
    unplacedIdentity.mockReturnValue(UNPLACED_IDENTITY)
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
})

// The Phase 5b flag is the kill switch for an audience of ~5,021 people across
// 19 live tenants, so its OFF path is tested explicitly rather than assumed.
describe('handlePageBannerRoute — Phase 5b flag gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdWith = undefined
    document.body.innerHTML = '<div id="app"></div>'
    csat.mockReturnValue(false)
    unplaced.mockReturnValue(false)
    unplacedIdentity.mockReturnValue(UNPLACED_IDENTITY)
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

  it('does NOT resume down the list when the flag is off — the flag is the paywall banner\'s', async () => {
    // This branch predates the unplaced notice and belongs to the paywall
    // banner's kill switch. Widening it would change what a flagged-off admin
    // sees for reasons that have nothing to do with the flag, and the unplaced
    // notice reaches the page through its own gated module anyway.
    flag.mockResolvedValue(false)
    csat.mockReturnValue(false)
    unplaced.mockReturnValue(true)
    await expect(handlePageBannerRoute('paywall-admin')).resolves.toBe('none')
    expect(mountSpy).not.toHaveBeenCalled()
  })

  it('tells the unplaced banner which store admitted it', async () => {
    // Re-deriving this inside the component would cost a property read on the
    // one path that has no property.
    await expect(handlePageBannerRoute('unplaced')).resolves.toBe('unplaced')
    expect(flag).not.toHaveBeenCalled()
    expect(mountSpy).toHaveBeenCalledOnce()
    expect(createdWith).toEqual({ source: 'marker' })
  })

  it('mounts the same component for the gated module, reading the page property', async () => {
    await expect(handlePageBannerRoute('unplaced-property')).resolves.toBe('unplaced-property')
    expect(mountSpy).toHaveBeenCalledOnce()
    expect(createdWith).toEqual({ source: 'property' })
  })
})
