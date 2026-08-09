import { describe, it, expect, beforeEach, vi } from 'vitest'
import { decidePageBanner, handlePageBannerRoute } from './pageBanner'
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
vi.mock('@/utils/paywall/adminBannerFlag', () => ({ isAdminBannerEnabled: vi.fn() }))
vi.mock('@/model/globals', () => ({
  default: { apWrapper: { initializeContext: vi.fn().mockResolvedValue(undefined) } },
}))
vi.mock('@/components/UpgradePrompt/PaywallWarningBanner.vue', () => ({ default: { name: 'PaywallBanner' } }))
vi.mock('@/components/CSAT/CsatBanner.vue', () => ({ default: { name: 'CsatBanner' } }))

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
const flag = vi.mocked((await import('@/utils/paywall/adminBannerFlag')).isAdminBannerEnabled)

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
})
