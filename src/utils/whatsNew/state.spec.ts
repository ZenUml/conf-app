import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}))

import { currentRelease, WHATS_NEW_WINDOW_MS, type WhatsNewRelease } from './releases'
import {
  audienceMarkerKey,
  bannerRecordKey,
  isWhatsNewAudience,
  markWhatsNewAudience,
  parseBannerRecord,
  readBannerRecord,
  recordWhatsNewDismissed,
  recordWhatsNewShown,
  whatsNewCandidate,
  WHATS_NEW_AUDIENCE_REFRESH_MS,
  WHATS_NEW_AUDIENCE_TTL_MS,
  WHATS_NEW_MAX_SHOWS,
} from './state'

const NOW = Date.parse('2026-10-03T10:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function release(overrides: Partial<WhatsNewRelease> = {}): WhatsNewRelease {
  return {
    id: '2026-10',
    publishedAt: '2026-10-01',
    headline: 'Two new things',
    items: [{ id: 'a', title: 'A', body: 'Body A' }],
    ...overrides,
  }
}

describe('currentRelease', () => {
  it('returns nothing for an empty list', () => {
    expect(currentRelease('lite', NOW, [])).toBeNull()
  })

  it('waits for a future publishedAt', () => {
    expect(currentRelease('lite', NOW, [release({ publishedAt: '2026-10-04' })])).toBeNull()
  })

  it('stops after the display window', () => {
    const r = release()
    const start = Date.parse(r.publishedAt)
    expect(currentRelease('lite', start + WHATS_NEW_WINDOW_MS - 1, [r])).toBe(r)
    expect(currentRelease('lite', start + WHATS_NEW_WINDOW_MS, [r])).toBeNull()
  })

  it('picks the newest live release regardless of list order', () => {
    const older = release({ id: 'old', publishedAt: '2026-09-20' })
    const newer = release({ id: 'new', publishedAt: '2026-10-02' })
    expect(currentRelease('lite', NOW, [older, newer])?.id).toBe('new')
    expect(currentRelease('lite', NOW, [newer, older])?.id).toBe('new')
  })

  it('honours the variant filter', () => {
    const r = release({ variants: ['full'] })
    expect(currentRelease('lite', NOW, [r])).toBeNull()
    expect(currentRelease('full', NOW, [r])).toBe(r)
  })

  it('skips releases with no items or an unparseable date', () => {
    expect(currentRelease('lite', NOW, [release({ items: [] })])).toBeNull()
    expect(currentRelease('lite', NOW, [release({ publishedAt: 'soon' })])).toBeNull()
  })
})

describe('audience marker', () => {
  beforeEach(() => window.localStorage.clear())

  it('is tenant-scoped', () => {
    expect(audienceMarkerKey()).toBe('whatsNewAudience:example-tenant')
    expect(bannerRecordKey()).toBe('whatsNewBanner:example-tenant')
  })

  it('is absent until a macro renders', () => {
    expect(isWhatsNewAudience(NOW)).toBe(false)
    markWhatsNewAudience(NOW)
    expect(isWhatsNewAudience(NOW)).toBe(true)
  })

  it('expires after the TTL', () => {
    markWhatsNewAudience(NOW)
    expect(isWhatsNewAudience(NOW + WHATS_NEW_AUDIENCE_TTL_MS - 1)).toBe(true)
    expect(isWhatsNewAudience(NOW + WHATS_NEW_AUDIENCE_TTL_MS)).toBe(false)
  })

  it('rewrites at most once per refresh interval', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    markWhatsNewAudience(NOW)
    markWhatsNewAudience(NOW + 1000)
    expect(spy).toHaveBeenCalledTimes(1)
    markWhatsNewAudience(NOW + WHATS_NEW_AUDIENCE_REFRESH_MS)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('never throws when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => markWhatsNewAudience(NOW)).not.toThrow()
    expect(isWhatsNewAudience(NOW)).toBe(false)
    spy.mockRestore()
  })
})

describe('banner record', () => {
  beforeEach(() => window.localStorage.clear())

  it('rejects malformed records', () => {
    expect(parseBannerRecord(null)).toBeNull()
    expect(parseBannerRecord('not json')).toBeNull()
    expect(parseBannerRecord(JSON.stringify({ releaseId: 'x', shows: 'two', dismissed: false }))).toBeNull()
  })

  it('counts impressions per release', () => {
    expect(recordWhatsNewShown('2026-10')).toBe(1)
    expect(recordWhatsNewShown('2026-10')).toBe(2)
    expect(readBannerRecord('2026-10').shows).toBe(2)
  })

  it('resets for a new release', () => {
    recordWhatsNewShown('2026-10')
    recordWhatsNewDismissed('2026-10')
    expect(readBannerRecord('2026-11')).toEqual({ releaseId: '2026-11', shows: 0, dismissed: false })
    expect(recordWhatsNewShown('2026-11')).toBe(1)
  })
})

describe('whatsNewCandidate — the host gate', () => {
  const releases = [release()]
  beforeEach(() => window.localStorage.clear())

  it('needs the audience marker', () => {
    expect(whatsNewCandidate(NOW, 'lite', releases)).toBeNull()
    markWhatsNewAudience(NOW)
    expect(whatsNewCandidate(NOW, 'lite', releases)?.id).toBe('2026-10')
  })

  it('needs a live release', () => {
    markWhatsNewAudience(NOW)
    expect(whatsNewCandidate(NOW, 'lite', [])).toBeNull()
  })

  it('stands down once dismissed', () => {
    markWhatsNewAudience(NOW)
    recordWhatsNewDismissed('2026-10')
    expect(whatsNewCandidate(NOW, 'lite', releases)).toBeNull()
  })

  it('stands down after the impression cap', () => {
    markWhatsNewAudience(NOW)
    for (let i = 0; i < WHATS_NEW_MAX_SHOWS; i++) {
      expect(whatsNewCandidate(NOW, 'lite', releases)).not.toBeNull()
      recordWhatsNewShown('2026-10')
    }
    expect(whatsNewCandidate(NOW, 'lite', releases)).toBeNull()
  })

  it('stands down when E2E switches it off', () => {
    markWhatsNewAudience(NOW)
    window.localStorage.setItem('mockWhatsNewEnabled', 'false')
    expect(whatsNewCandidate(NOW, 'lite', releases)).toBeNull()
    window.localStorage.setItem('mockWhatsNewEnabled', 'true')
    expect(whatsNewCandidate(NOW, 'lite', releases)?.id).toBe('2026-10')
  })

  it('re-arms for the next release after a dismissal', () => {
    markWhatsNewAudience(NOW)
    recordWhatsNewDismissed('2026-10')
    const next = [release(), release({ id: '2026-10b', publishedAt: '2026-10-02' })]
    expect(whatsNewCandidate(NOW + DAY, 'lite', next)?.id).toBe('2026-10b')
  })
})
