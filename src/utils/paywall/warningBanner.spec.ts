import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  RECENT_MACRO_ACTIVITY_WINDOW_MS,
  WARNING_BANNER_SUPPRESSION_MS,
  BANNER_TAPER_DAILY_GAP_MS,
  BANNER_TAPER_WEEKLY_GAP_MS,
  targetingMarkerKey,
  dismissalMarkerKey,
  macroActivityMarkerKey,
  parseTargetingMarker,
  parseMacroActivityMarker,
  parseDismissalMarker,
  readTargetingMarker,
  writeTargetingMarker,
  readMacroActivityMarker,
  markRecentMacroActivity,
  recordBannerShown,
  recordBannerDismissed,
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
  it('targeting and dismissal keys are distinct, single-writer namespaces', () => {
    expect(targetingMarkerKey(ID)).toBe('paywallWarning:example-tenant:ENG')
    expect(dismissalMarkerKey(ID)).toBe('paywallBanner:example-tenant:ENG')
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
    expect(parseDismissalMarker('nope')).toBeNull()
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

  it('defaults a dismissal marker showCount to 0 and dismissedAt to null', () => {
    expect(parseDismissalMarker(JSON.stringify({ lastShownAt: 'x' }))).toEqual({
      dismissedAt: null,
      lastShownAt: 'x',
      showCount: 0,
    })
  })
})

describe('visibility gate', () => {
  const now = Date.parse('2026-06-10T00:00:00.000Z')

  it('shows when CSS is enabled, unpaid, over 100, recent activity, never dismissed', () => {
    expect(isWarningBannerVisible(warning, null, recentActivity, now)).toBe(true)
  })

  it('hides when no targeting marker exists', () => {
    expect(isWarningBannerVisible(null, null, recentActivity, now)).toBe(false)
  })

  it('hides when CUSTOMER_SUCCESS_SERVICE is disabled', () => {
    expect(isWarningBannerVisible({ ...warning, customerSuccessServiceEnabled: false }, null, recentActivity, now)).toBe(false)
  })

  it('hides when macro count is exactly 100', () => {
    expect(isWarningBannerVisible({ ...warning, macroCount: 100 }, null, recentActivity, now)).toBe(false)
  })

  it('hides when macro count is below 100', () => {
    expect(isWarningBannerVisible({ ...warning, macroCount: 99 }, null, recentActivity, now)).toBe(false)
  })

  it('hides when the space is paid', () => {
    expect(isWarningBannerVisible({ ...warning, spacePaid: true }, null, recentActivity, now)).toBe(false)
  })

  it('hides when the user has no recorded macro activity', () => {
    expect(isWarningBannerVisible(warning, null, null, now)).toBe(false)
  })

  it('hides when the user activity is older than 30 days', () => {
    const staleActivity = {
      ...recentActivity,
      lastActivityAt: new Date(now - (RECENT_MACRO_ACTIVITY_WINDOW_MS + 1000)).toISOString(),
    }
    expect(isWarningBannerVisible(warning, null, staleActivity, now)).toBe(false)
  })

  it('hides within the 7-day snooze window after dismissal', () => {
    const dismissedAt = new Date(now - (WARNING_BANNER_SUPPRESSION_MS - 1000)).toISOString()
    expect(isWarningBannerVisible(warning, { dismissedAt, lastShownAt: null, showCount: 1 }, recentActivity, now)).toBe(false)
  })

  it('returns after the snooze window elapses (problem still unsolved)', () => {
    const dismissedAt = new Date(now - (WARNING_BANNER_SUPPRESSION_MS + 1000)).toISOString()
    expect(isWarningBannerVisible(warning, { dismissedAt, lastShownAt: null, showCount: 1 }, recentActivity, now)).toBe(true)
  })
})

// Impression taper (2026-09-07). Before this, the only suppression was the
// 7-day snooze after an explicit dismiss; a user who never clicked × saw the
// banner on every page load (median 16, p90 121 impressions per user in 30d).
// Now the gap between impressions grows with showCount: 1st immediately, 2nd
// and 3rd at least 24h apart, 4th onwards at least 7 days apart.
describe('visibility gate — impression taper', () => {
  const now = Date.parse('2026-06-10T00:00:00.000Z')
  const shownAgo = (ms: number, showCount: number) => ({
    dismissedAt: null,
    lastShownAt: new Date(now - ms).toISOString(),
    showCount,
  })

  it('shows the 1st impression immediately (no dismissal marker at all)', () => {
    expect(isWarningBannerVisible(warning, null, recentActivity, now)).toBe(true)
  })

  it('hides the 2nd impression when the 1st was less than 24h ago', () => {
    expect(isWarningBannerVisible(warning, shownAgo(BANNER_TAPER_DAILY_GAP_MS - 1000, 1), recentActivity, now)).toBe(false)
  })

  it('shows the 2nd impression once 24h have passed', () => {
    expect(isWarningBannerVisible(warning, shownAgo(BANNER_TAPER_DAILY_GAP_MS, 1), recentActivity, now)).toBe(true)
  })

  it('shows the 3rd impression once 24h have passed since the 2nd', () => {
    expect(isWarningBannerVisible(warning, shownAgo(BANNER_TAPER_DAILY_GAP_MS, 2), recentActivity, now)).toBe(true)
  })

  it('hides the 4th impression when the 3rd was only 2 days ago', () => {
    expect(isWarningBannerVisible(warning, shownAgo(2 * BANNER_TAPER_DAILY_GAP_MS, 3), recentActivity, now)).toBe(false)
  })

  it('shows the 4th impression once 7 days have passed', () => {
    expect(isWarningBannerVisible(warning, shownAgo(BANNER_TAPER_WEEKLY_GAP_MS, 3), recentActivity, now)).toBe(true)
  })

  it('keeps the weekly gap for every later impression (e.g. the 50th)', () => {
    expect(isWarningBannerVisible(warning, shownAgo(6 * BANNER_TAPER_DAILY_GAP_MS, 49), recentActivity, now)).toBe(false)
    expect(isWarningBannerVisible(warning, shownAgo(BANNER_TAPER_WEEKLY_GAP_MS, 49), recentActivity, now)).toBe(true)
  })

  it('fails open when a legacy marker has a showCount but no lastShownAt', () => {
    expect(isWarningBannerVisible(warning, { dismissedAt: null, lastShownAt: null, showCount: 5 }, recentActivity, now)).toBe(true)
  })

  it('applies the same taper to the space-admin audience', () => {
    expect(isWarningBannerVisible(warning, shownAgo(2 * BANNER_TAPER_DAILY_GAP_MS, 3), null, now, true)).toBe(false)
    expect(isWarningBannerVisible(warning, shownAgo(BANNER_TAPER_WEEKLY_GAP_MS, 3), null, now, true)).toBe(true)
  })

  it('after the 7-day snooze elapses, the weekly taper (not the snooze) governs', () => {
    // Dismissed 8 days ago, last shown 8 days ago, 3 prior impressions:
    // snooze is over AND the weekly gap is met -> shows.
    const eightDays = WARNING_BANNER_SUPPRESSION_MS + BANNER_TAPER_DAILY_GAP_MS
    const marker = { ...shownAgo(eightDays, 3), dismissedAt: new Date(now - eightDays).toISOString() }
    expect(isWarningBannerVisible(warning, marker, recentActivity, now)).toBe(true)
  })
})

// Phase 5b. The legacy gate requires the viewer to have authored a macro in the
// last 30 days, which structurally excludes space admins who don't draw
// diagrams — i.e. the only people on the page who can actually resolve the
// limit. A space admin of an over-limit space is a first-class audience.
describe('visibility gate — space-admin audience (Phase 5b)', () => {
  const now = Date.parse('2026-06-10T00:00:00.000Z')

  it('shows to a space admin with NO macro activity at all', () => {
    expect(isWarningBannerVisible(warning, null, null, now, true)).toBe(true)
  })

  it('shows to a space admin whose activity is older than the 30-day window', () => {
    const stale = {
      ...recentActivity,
      lastActivityAt: new Date(now - (RECENT_MACRO_ACTIVITY_WINDOW_MS + 1000)).toISOString(),
    }
    expect(isWarningBannerVisible(warning, null, stale, now, true)).toBe(true)
  })

  it('still hides from a NON-admin with no activity (legacy gate unchanged)', () => {
    expect(isWarningBannerVisible(warning, null, null, now, false)).toBe(false)
  })

  it('defaults to the non-admin gate when the flag is omitted', () => {
    expect(isWarningBannerVisible(warning, null, null, now)).toBe(false)
  })

  // Admin status relaxes ONLY the authorship requirement. Every other gate is
  // about whether there is a real problem to report, and still applies.
  it('hides from an admin when CUSTOMER_SUCCESS_SERVICE is disabled', () => {
    expect(
      isWarningBannerVisible({ ...warning, customerSuccessServiceEnabled: false }, null, null, now, true)
    ).toBe(false)
  })

  it('hides from an admin when the space is already paid', () => {
    expect(isWarningBannerVisible({ ...warning, spacePaid: true }, null, null, now, true)).toBe(false)
  })

  it('hides from an admin when the space is not over the limit', () => {
    expect(isWarningBannerVisible({ ...warning, macroCount: 100 }, null, null, now, true)).toBe(false)
  })

  it('hides from an admin inside the 7-day snooze window', () => {
    const dismissedAt = new Date(now - (WARNING_BANNER_SUPPRESSION_MS - 1000)).toISOString()
    expect(
      isWarningBannerVisible(warning, { dismissedAt, lastShownAt: null, showCount: 1 }, null, now, true)
    ).toBe(false)
  })

  it('hides from an admin with no targeting marker', () => {
    expect(isWarningBannerVisible(null, null, null, now, true)).toBe(false)
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

describe('dismissal marker — single writer (banner)', () => {
  it('recordBannerShown increments showCount and preserves dismissedAt', () => {
    writeTargetingMarker(warning, ID)
    const dismissedAt = '2026-05-01T00:00:00.000Z'
    recordBannerDismissed(ID, new Date(dismissedAt))
    const after = recordBannerShown(ID, new Date('2026-06-02T00:00:00.000Z'))
    expect(after.showCount).toBe(1)
    expect(after.lastShownAt).toBe('2026-06-02T00:00:00.000Z')
    expect(after.dismissedAt).toBe(dismissedAt)
  })

  it('recordBannerDismissed stamps dismissedAt and preserves showCount', () => {
    recordBannerShown(ID, new Date('2026-06-01T00:00:00.000Z'))
    recordBannerShown(ID, new Date('2026-06-02T00:00:00.000Z'))
    const after = recordBannerDismissed(ID, new Date('2026-06-03T00:00:00.000Z'))
    expect(after.dismissedAt).toBe('2026-06-03T00:00:00.000Z')
    expect(after.showCount).toBe(2)
  })
})

describe('shouldShowPaywallBanner — reads from localStorage', () => {
  const now = Date.parse('2026-06-10T00:00:00.000Z')

  it('true when targeting and recent activity markers are present', () => {
    writeTargetingMarker(warning, ID)
    markRecentMacroActivity('edit', ID, new Date('2026-06-09T00:00:00.000Z'))
    expect(shouldShowPaywallBanner(now, ID)).toBe(true)
  })

  it('false after a fresh dismissal', () => {
    writeTargetingMarker(warning, ID)
    markRecentMacroActivity('edit', ID, new Date('2026-06-09T00:00:00.000Z'))
    recordBannerDismissed(ID, new Date(now))
    expect(shouldShowPaywallBanner(now, ID)).toBe(false)
  })

  it('false when storage access throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(shouldShowPaywallBanner(now, ID)).toBe(false)
    spy.mockRestore()
  })
})

describe('CSAT defer contract', () => {
  // forgeIndex's CSAT branch yields when shouldShowPaywallBanner() is true, so
  // the two pageBanner modules never stack (paywall > CSAT). This asserts the
  // signal CSAT keys off of.
  const now = Date.parse('2026-06-10T00:00:00.000Z')

  it('paywall eligible (CSS enabled, unpaid, over 100, recent activity, unsnoozed) → CSAT must defer', () => {
    writeTargetingMarker(warning, ID)
    markRecentMacroActivity('edit', ID, new Date('2026-06-09T00:00:00.000Z'))
    expect(shouldShowPaywallBanner(now, ID)).toBe(true)
  })

  it('paywall not eligible (no marker) → CSAT proceeds', () => {
    expect(shouldShowPaywallBanner(now, ID)).toBe(false)
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
