import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  WARNING_BANNER_SUPPRESSION_MS,
  targetingMarkerKey,
  dismissalMarkerKey,
  parseTargetingMarker,
  parseDismissalMarker,
  readTargetingMarker,
  writeTargetingMarker,
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
  severity: 'warning',
  macroCount: 90,
  spacePaid: false,
  updatedAt: '2026-06-02T00:00:00.000Z',
}

beforeEach(() => {
  localStorage.clear()
})

describe('key builders', () => {
  it('targeting and dismissal keys are distinct, single-writer namespaces', () => {
    expect(targetingMarkerKey(ID)).toBe('paywallWarning:example-tenant:ENG')
    expect(dismissalMarkerKey(ID)).toBe('paywallBanner:example-tenant:ENG')
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
    expect(parseDismissalMarker('nope')).toBeNull()
  })

  it('rejects a targeting marker with an invalid severity', () => {
    expect(parseTargetingMarker(JSON.stringify({ ...warning, severity: 'bogus' }))).toBeNull()
  })

  it('rejects a targeting marker missing required fields', () => {
    expect(parseTargetingMarker(JSON.stringify({ severity: 'warning' }))).toBeNull()
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

  it('shows when warning, unpaid, never dismissed', () => {
    expect(isWarningBannerVisible(warning, null, now)).toBe(true)
  })

  it('hides when no targeting marker exists', () => {
    expect(isWarningBannerVisible(null, null, now)).toBe(false)
  })

  it('hides when severity is none (below warning band)', () => {
    expect(isWarningBannerVisible({ ...warning, severity: 'none' }, null, now)).toBe(false)
  })

  it('hides when severity is critical (the modal owns 100+)', () => {
    expect(isWarningBannerVisible({ ...warning, severity: 'critical' }, null, now)).toBe(false)
  })

  it('hides when the space is paid', () => {
    expect(isWarningBannerVisible({ ...warning, spacePaid: true }, null, now)).toBe(false)
  })

  it('hides within the 7-day snooze window after dismissal', () => {
    const dismissedAt = new Date(now - (WARNING_BANNER_SUPPRESSION_MS - 1000)).toISOString()
    expect(isWarningBannerVisible(warning, { dismissedAt, lastShownAt: null, showCount: 1 }, now)).toBe(false)
  })

  it('returns after the snooze window elapses (problem still unsolved)', () => {
    const dismissedAt = new Date(now - (WARNING_BANNER_SUPPRESSION_MS + 1000)).toISOString()
    expect(isWarningBannerVisible(warning, { dismissedAt, lastShownAt: null, showCount: 1 }, now)).toBe(true)
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

  it('true when only the warning targeting marker is present', () => {
    writeTargetingMarker(warning, ID)
    expect(shouldShowPaywallBanner(now, ID)).toBe(true)
  })

  it('false after a fresh dismissal', () => {
    writeTargetingMarker(warning, ID)
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

  it('paywall eligible (warning, unpaid, unsnoozed) → CSAT must defer', () => {
    writeTargetingMarker(warning, ID)
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
