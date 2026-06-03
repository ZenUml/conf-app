import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  RECENT_MACRO_ACTIVITY_WINDOW_MS,
  WARNING_BANNER_SUPPRESSION_MS,
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
