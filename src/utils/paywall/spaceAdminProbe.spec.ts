import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mutable mocks shared with the hoisted vi.mock factories below.
const h = vi.hoisted(() => ({
  initializeContext: vi.fn().mockResolvedValue(undefined),
  getCurrentSpaceAdmins: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
  identity: { clientDomain: 'example-tenant', spaceKey: 'ENG' } as {
    clientDomain: string
    spaceKey: string
  },
  forge: { forgeContext: { accountId: 'user-self' } as any },
}))

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      initializeContext: h.initializeContext,
      getCurrentSpaceAdmins: h.getCurrentSpaceAdmins,
    },
  },
}))
vi.mock('@/model/globals/forgeGlobal', () => ({ default: h.forge }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: h.trackAnalyticsEvent,
}))
vi.mock('@/utils/paywall/warningBanner', () => ({
  deriveWarningBannerIdentity: () => h.identity,
}))

import {
  SPACE_ADMIN_PROBE_WINDOW_MS,
  spaceAdminProbeKey,
  parseProbeMarker,
  isProbeDue,
  readProbeMarker,
  maybeProbeSpaceAdmin,
  isCurrentUserSpaceAdmin,
  type SpaceAdminProbeMarker,
} from './spaceAdminProbe'

const NOW = Date.parse('2026-06-03T12:00:00.000Z')

function storedMarker(): SpaceAdminProbeMarker | null {
  return parseProbeMarker(localStorage.getItem(spaceAdminProbeKey(h.identity)))
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.stubEnv('PRODUCT_TYPE', 'lite')
  h.identity = { clientDomain: 'example-tenant', spaceKey: 'ENG' }
  h.forge.forgeContext = { accountId: 'user-self' }
  h.initializeContext.mockResolvedValue(undefined)
  h.getCurrentSpaceAdmins.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('key builder + marker parse', () => {
  it('builds a domain:space-scoped key (no accountId)', () => {
    expect(spaceAdminProbeKey({ clientDomain: 'example-tenant', spaceKey: 'ENG' })).toBe(
      'paywallAdminProbe:example-tenant:ENG'
    )
  })

  it('encodes parts and falls back to "unknown"', () => {
    expect(spaceAdminProbeKey({ clientDomain: 'a b/c', spaceKey: '' })).toBe(
      `paywallAdminProbe:${encodeURIComponent('a b/c')}:unknown`
    )
  })

  it('parses a valid marker and rejects junk', () => {
    expect(parseProbeMarker(JSON.stringify({ lastProbedAt: 'x' }))).toEqual({ lastProbedAt: 'x' })
    expect(parseProbeMarker(null)).toBeNull()
    expect(parseProbeMarker('not json')).toBeNull()
    expect(parseProbeMarker(JSON.stringify({ lastProbedAt: 5 }))).toBeNull()
  })
})

describe('isProbeDue', () => {
  it('is due when no marker', () => {
    expect(isProbeDue(null, NOW)).toBe(true)
  })
  it('is not due within the 30-day window', () => {
    // Carries a verdict — i.e. a marker this build wrote. A verdict-less
    // (Phase-5a) marker is due regardless of age; see the Phase 5b block below.
    const recent = { lastProbedAt: new Date(NOW - 1000).toISOString(), isAdmin: false }
    expect(isProbeDue(recent, NOW)).toBe(false)
  })
  it('is due once past the window', () => {
    const old = { lastProbedAt: new Date(NOW - SPACE_ADMIN_PROBE_WINDOW_MS - 1).toISOString() }
    expect(isProbeDue(old, NOW)).toBe(true)
  })
  it('is due when the stored timestamp is unparseable', () => {
    expect(isProbeDue({ lastProbedAt: 'nonsense' }, NOW)).toBe(true)
  })
})

describe('maybeProbeSpaceAdmin', () => {
  it('short-circuits on non-Lite variants (no init, no event)', async () => {
    vi.stubEnv('PRODUCT_TYPE', 'full')
    await maybeProbeSpaceAdmin(NOW)
    expect(h.initializeContext).not.toHaveBeenCalled()
    expect(h.trackAnalyticsEvent).not.toHaveBeenCalled()
  })

  it('short-circuits when identity is unknown', async () => {
    h.identity = { clientDomain: 'unknown', spaceKey: 'ENG' }
    await maybeProbeSpaceAdmin(NOW)
    expect(h.initializeContext).not.toHaveBeenCalled()
  })

  it('short-circuits (no init/REST) when already probed within the window', async () => {
    localStorage.setItem(
      spaceAdminProbeKey(h.identity),
      JSON.stringify({ lastProbedAt: new Date(NOW - 1000).toISOString(), isAdmin: false })
    )
    await maybeProbeSpaceAdmin(NOW)
    expect(h.initializeContext).not.toHaveBeenCalled()
    expect(h.getCurrentSpaceAdmins).not.toHaveBeenCalled()
  })

  it('fires space_admin_active and writes the marker when the user IS an admin', async () => {
    h.getCurrentSpaceAdmins.mockResolvedValue([
      { type: 'user', id: 'user-self', displayName: 'Me' },
      { type: 'user', id: 'someone-else', displayName: 'Other' },
    ])
    await maybeProbeSpaceAdmin(NOW)

    expect(h.trackAnalyticsEvent).toHaveBeenCalledWith('space_admin_active', {
      feature_area: 'upgrade',
      surface: 'page_banner',
      is_space_admin: true,
      space_admin_count: 2,
    })
    expect(storedMarker()?.lastProbedAt).toBe(new Date(NOW).toISOString())
  })

  it('writes the marker but fires NO event when the user is NOT an admin', async () => {
    h.getCurrentSpaceAdmins.mockResolvedValue([
      { type: 'user', id: 'someone-else', displayName: 'Other' },
    ])
    await maybeProbeSpaceAdmin(NOW)

    expect(h.trackAnalyticsEvent).not.toHaveBeenCalled()
    expect(storedMarker()?.lastProbedAt).toBe(new Date(NOW).toISOString())
  })

  it('does not resolve admins or write a marker when accountId is missing', async () => {
    h.forge.forgeContext = {}
    await maybeProbeSpaceAdmin(NOW)
    expect(h.getCurrentSpaceAdmins).not.toHaveBeenCalled()
    expect(storedMarker()).toBeNull()
  })

  it('writes no marker (retries next load) when the resolver returns undefined', async () => {
    h.getCurrentSpaceAdmins.mockResolvedValue(undefined)
    await maybeProbeSpaceAdmin(NOW)
    expect(h.trackAnalyticsEvent).not.toHaveBeenCalled()
    expect(storedMarker()).toBeNull()
  })

  it('swallows resolver errors and writes no marker', async () => {
    h.getCurrentSpaceAdmins.mockRejectedValue(new Error('REST 500'))
    await expect(maybeProbeSpaceAdmin(NOW)).resolves.toBeUndefined()
    expect(h.trackAnalyticsEvent).not.toHaveBeenCalled()
    expect(storedMarker()).toBeNull()
  })

  it('re-probes once the window has elapsed', async () => {
    localStorage.setItem(
      spaceAdminProbeKey(h.identity),
      JSON.stringify({ lastProbedAt: new Date(NOW - SPACE_ADMIN_PROBE_WINDOW_MS - 1).toISOString() })
    )
    h.getCurrentSpaceAdmins.mockResolvedValue([{ type: 'user', id: 'user-self', displayName: 'Me' }])
    await maybeProbeSpaceAdmin(NOW)
    expect(h.initializeContext).toHaveBeenCalledOnce()
    expect(h.trackAnalyticsEvent).toHaveBeenCalledOnce()
  })

  it('readProbeMarker uses the derived identity by default', async () => {
    expect(readProbeMarker()).toBeNull()
    localStorage.setItem(spaceAdminProbeKey(h.identity), JSON.stringify({ lastProbedAt: 'x', isAdmin: false }))
    expect(readProbeMarker()).toEqual({ lastProbedAt: 'x', isAdmin: false })
  })
})

// Phase 5b. The banner's visibility gate is synchronous (it runs in setup(),
// before any await), so the admin verdict has to be readable from localStorage
// — firing an analytics event is not enough. The probe therefore persists the
// verdict alongside the throttle timestamp.
describe('admin verdict persistence (Phase 5b)', () => {
  it('persists isAdmin=true and the admin count when the user IS an admin', async () => {
    h.getCurrentSpaceAdmins.mockResolvedValue([
      { type: 'user', id: 'user-self', displayName: 'Me' },
      { type: 'user', id: 'someone-else', displayName: 'Other' },
    ])
    await maybeProbeSpaceAdmin(NOW)
    expect(storedMarker()).toEqual({
      lastProbedAt: new Date(NOW).toISOString(),
      isAdmin: true,
      adminCount: 2,
    })
  })

  it('persists isAdmin=false when the user is NOT an admin', async () => {
    h.getCurrentSpaceAdmins.mockResolvedValue([{ type: 'user', id: 'someone-else', displayName: 'Other' }])
    await maybeProbeSpaceAdmin(NOW)
    expect(storedMarker()).toEqual({
      lastProbedAt: new Date(NOW).toISOString(),
      isAdmin: false,
      adminCount: 1,
    })
  })

  it('parses a marker carrying the verdict, and rejects a non-boolean verdict', () => {
    expect(parseProbeMarker(JSON.stringify({ lastProbedAt: 'x', isAdmin: true, adminCount: 3 }))).toEqual({
      lastProbedAt: 'x',
      isAdmin: true,
      adminCount: 3,
    })
    expect(parseProbeMarker(JSON.stringify({ lastProbedAt: 'x', isAdmin: 'yes' }))).toEqual({
      lastProbedAt: 'x',
    })
  })

  // Phase-5a-era markers carry only a timestamp. Honouring their 30-day
  // throttle would leave every already-probed admin invisible to the banner for
  // up to a month after release, so a verdict-less marker counts as due.
  it('treats a legacy marker with no verdict as due for a re-probe', () => {
    expect(isProbeDue({ lastProbedAt: new Date(NOW - 1000).toISOString() }, NOW)).toBe(true)
  })

  it('honours the 30-day throttle once a verdict is present', () => {
    expect(
      isProbeDue({ lastProbedAt: new Date(NOW - 1000).toISOString(), isAdmin: false }, NOW)
    ).toBe(false)
  })
})

describe('isCurrentUserSpaceAdmin', () => {
  it('is false when no marker exists (fail closed — banner stays editor-only)', () => {
    expect(isCurrentUserSpaceAdmin()).toBe(false)
  })

  it('is false for a legacy marker with no verdict', () => {
    localStorage.setItem(spaceAdminProbeKey(h.identity), JSON.stringify({ lastProbedAt: 'x' }))
    expect(isCurrentUserSpaceAdmin()).toBe(false)
  })

  it('reads a persisted true verdict', () => {
    localStorage.setItem(
      spaceAdminProbeKey(h.identity),
      JSON.stringify({ lastProbedAt: 'x', isAdmin: true, adminCount: 2 })
    )
    expect(isCurrentUserSpaceAdmin()).toBe(true)
  })

  it('reads a persisted false verdict', () => {
    localStorage.setItem(
      spaceAdminProbeKey(h.identity),
      JSON.stringify({ lastProbedAt: 'x', isAdmin: false, adminCount: 2 })
    )
    expect(isCurrentUserSpaceAdmin()).toBe(false)
  })

  // A stale verdict still beats no verdict: the probe re-runs on this same page
  // load and corrects it, and hiding the banner from a known admin for one load
  // is worse than showing it to someone who was an admin last month.
  it('keeps returning a stale true verdict while the re-probe is in flight', () => {
    localStorage.setItem(
      spaceAdminProbeKey(h.identity),
      JSON.stringify({
        lastProbedAt: new Date(NOW - SPACE_ADMIN_PROBE_WINDOW_MS - 1).toISOString(),
        isAdmin: true,
        adminCount: 2,
      })
    )
    expect(isCurrentUserSpaceAdmin()).toBe(true)
  })
})
