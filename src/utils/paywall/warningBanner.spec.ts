import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  RECENT_MACRO_ACTIVITY_WINDOW_MS,
  targetingMarkerKey,
  impressionMarkerKey,
  macroActivityMarkerKey,
  parseTargetingMarker,
  parseMacroActivityMarker,
  parseImpressionMarker,
  readTargetingMarker,
  writeTargetingMarker,
  readMacroActivityMarker,
  markRecentMacroActivity,
  recordBannerShown,
  readImpressionMarker,
  isWarningBannerVisible,
  bannerAudience,
  shouldShowPaywallBanner,
  toMarkerSeverity,
  type WarningBannerIdentity,
  type TargetingMarker,
} from './warningBanner'

const ID: WarningBannerIdentity = { clientDomain: 'example-tenant', spaceKey: 'ENG' }

const warning: TargetingMarker = {
  severity: 'critical',
  macroCount: 101,
  spacePaid: false,
  customerSuccessServiceEnabled: true,
  updatedAt: '2026-06-02T00:00:00.000Z',
}

const recentActivity = {
  lastActivityAt: '2026-06-09T00:00:00.000Z',
  activityType: 'edit' as const,
}

beforeEach(() => {
  localStorage.clear()
})

describe('key builders', () => {
  it('targeting and impression keys are distinct, single-writer namespaces', () => {
    expect(targetingMarkerKey(ID)).toBe('paywallWarning:example-tenant:ENG')
    expect(impressionMarkerKey(ID)).toBe('paywallBanner:example-tenant:ENG')
    expect(macroActivityMarkerKey(ID)).toBe('paywallActivity:example-tenant:ENG')
  })

  it('encodes key parts and falls back to "unknown" for empty values', () => {
    const key = targetingMarkerKey({ clientDomain: 'a b/c', spaceKey: '' })
    expect(key).toBe(`paywallWarning:${encodeURIComponent('a b/c')}:unknown`)
  })
})

describe('parse — defensive', () => {
  it('round-trips a targeting marker through write/read', () => {
    writeTargetingMarker(warning, ID)
    expect(readTargetingMarker(ID)).toEqual(warning)
  })

  it('returns null for corrupt JSON', () => {
    expect(parseTargetingMarker('{not json')).toBeNull()
    expect(parseMacroActivityMarker('{not json')).toBeNull()
    expect(parseImpressionMarker('nope')).toBeNull()
  })

  it('rejects a targeting marker with an invalid severity', () => {
    expect(parseTargetingMarker(JSON.stringify({ ...warning, severity: 'bogus' }))).toBeNull()
  })

  it('rejects a targeting marker missing required fields', () => {
    expect(parseTargetingMarker(JSON.stringify({ severity: 'warning' }))).toBeNull()
  })

  it('round-trips an activity marker through mark/read', () => {
    markRecentMacroActivity('create', ID, new Date('2026-06-03T00:00:00.000Z'))
    expect(readMacroActivityMarker(ID)).toEqual({
      lastActivityAt: '2026-06-03T00:00:00.000Z',
      activityType: 'create',
    })
  })

  it('rejects an invalid activity marker', () => {
    expect(parseMacroActivityMarker(JSON.stringify({ lastActivityAt: 'x', activityType: 'view' }))).toBeNull()
  })

  it('parses legacy markers as impression data and ignores dismissedAt', () => {
    expect(parseImpressionMarker(JSON.stringify({ dismissedAt: '2026-06-01', lastShownAt: 'x' }))).toEqual({
      lastShownAt: 'x',
      showCount: 0,
    })
  })
})

describe('visibility gate', () => {
  const now = Date.parse('2026-06-10T00:00:00.000Z')

  it('shows for an unpaid over-limit space with policy enabled and a recent author', () => {
    expect(isWarningBannerVisible(warning, recentActivity, now)).toBe(true)
  })

  it('requires a valid targeting marker and effective Lite paywall policy', () => {
    expect(isWarningBannerVisible(null, recentActivity, now)).toBe(false)
    expect(isWarningBannerVisible({ ...warning, customerSuccessServiceEnabled: false }, recentActivity, now)).toBe(false)
  })

  it('requires more than 100 macros in an unpaid space', () => {
    expect(isWarningBannerVisible({ ...warning, macroCount: 100 }, recentActivity, now)).toBe(false)
    expect(isWarningBannerVisible({ ...warning, macroCount: 99 }, recentActivity, now)).toBe(false)
    expect(isWarningBannerVisible({ ...warning, spacePaid: true }, recentActivity, now)).toBe(false)
  })

  it('requires recent activity for a non-admin', () => {
    const stale = { ...recentActivity, lastActivityAt: new Date(now - RECENT_MACRO_ACTIVITY_WINDOW_MS - 1000).toISOString() }
    expect(isWarningBannerVisible(warning, null, now)).toBe(false)
    expect(isWarningBannerVisible(warning, stale, now)).toBe(false)
  })

  it('shows to a space admin without macro activity while preserving the policy and limit gates', () => {
    expect(isWarningBannerVisible(warning, null, now, true)).toBe(true)
    expect(isWarningBannerVisible({ ...warning, customerSuccessServiceEnabled: false }, null, now, true)).toBe(false)
    expect(isWarningBannerVisible({ ...warning, spacePaid: true }, null, now, true)).toBe(false)
    expect(isWarningBannerVisible({ ...warning, macroCount: 100 }, null, now, true)).toBe(false)
    expect(isWarningBannerVisible(null, null, now, true)).toBe(false)
  })

  it('shows to a space admin whose macro activity is older than 30 days', () => {
    const stale = { ...recentActivity, lastActivityAt: new Date(now - RECENT_MACRO_ACTIVITY_WINDOW_MS - 1000).toISOString() }
    expect(isWarningBannerVisible(warning, stale, now, true)).toBe(true)
  })

  it('requires authoring for a non-admin, including when admin status is omitted', () => {
    expect(isWarningBannerVisible(warning, null, now, false)).toBe(false)
    expect(isWarningBannerVisible(warning, null, now)).toBe(false)
  })
})

describe('bannerAudience', () => {
  it('reports space_admin for an admin — the stronger audience wins over editor', () => {
    expect(bannerAudience(true)).toBe('space_admin')
  })
  it('reports editor otherwise', () => {
    expect(bannerAudience(false)).toBe('editor')
  })
})

describe('impression marker — single writer (banner)', () => {
  it('recordBannerShown increments showCount without retaining a legacy dismissal', () => {
    localStorage.setItem(impressionMarkerKey(ID), JSON.stringify({ dismissedAt: '2026-05-01T00:00:00.000Z', lastShownAt: null, showCount: 50 }))
    const after = recordBannerShown(ID, new Date('2026-06-02T00:00:00.000Z'))
    expect(after.showCount).toBe(51)
    expect(after.lastShownAt).toBe('2026-06-02T00:00:00.000Z')
    expect(after).not.toHaveProperty('dismissedAt')
    expect(JSON.parse(localStorage.getItem(impressionMarkerKey(ID))!)).not.toHaveProperty('dismissedAt')
  })

  it('keeps counting consecutive impressions', () => {
    recordBannerShown(ID, new Date('2026-06-01T00:00:00.000Z'))
    recordBannerShown(ID, new Date('2026-06-02T00:00:00.000Z'))
    expect(readImpressionMarker(ID)).toEqual({ lastShownAt: '2026-06-02T00:00:00.000Z', showCount: 2 })
  })
})

describe('shouldShowPaywallBanner — reads from localStorage', () => {
  const now = Date.parse('2026-06-10T00:00:00.000Z')

  it('true when targeting and recent activity markers are present', () => {
    writeTargetingMarker(warning, ID)
    markRecentMacroActivity('edit', ID, new Date('2026-06-09T00:00:00.000Z'))
    expect(shouldShowPaywallBanner(now, ID)).toBe(true)
  })

  it('false without a targeting marker', () => {
    expect(shouldShowPaywallBanner(now, ID)).toBe(false)
  })

  it.each([1, 2, 3, 50].flatMap((showCount) => [false, true].map((isSpaceAdmin) => [showCount, isSpaceAdmin] as const)))(
    'stays true with legacy dismissal and %i prior impressions (admin: %s)',
    (showCount, isSpaceAdmin) => {
      writeTargetingMarker(warning, ID)
      if (!isSpaceAdmin) markRecentMacroActivity('edit', ID, new Date('2026-06-09T00:00:00.000Z'))
      localStorage.setItem(impressionMarkerKey(ID), JSON.stringify({ dismissedAt: new Date(now).toISOString(), lastShownAt: new Date(now).toISOString(), showCount }))
      expect(shouldShowPaywallBanner(now, ID, isSpaceAdmin)).toBe(true)
      recordBannerShown(ID, new Date(now))
      expect(shouldShowPaywallBanner(now, ID, isSpaceAdmin)).toBe(true)
    }
  )

  it('false when storage access throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(shouldShowPaywallBanner(now, ID)).toBe(false)
    spy.mockRestore()
  })
})

describe('toMarkerSeverity', () => {
  it('maps the composable "normal" band to the marker "none" band', () => {
    expect(toMarkerSeverity('normal')).toBe('none')
    expect(toMarkerSeverity('warning')).toBe('warning')
    expect(toMarkerSeverity('critical')).toBe('critical')
    expect(toMarkerSeverity('anything-else')).toBe('none')
  })
})
