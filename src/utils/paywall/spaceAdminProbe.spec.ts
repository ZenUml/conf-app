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
    const recent = { lastProbedAt: new Date(NOW - 1000).toISOString() }
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
      JSON.stringify({ lastProbedAt: new Date(NOW - 1000).toISOString() })
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
    localStorage.setItem(spaceAdminProbeKey(h.identity), JSON.stringify({ lastProbedAt: 'x' }))
    expect(readProbeMarker()).toEqual({ lastProbedAt: 'x' })
  })
})
