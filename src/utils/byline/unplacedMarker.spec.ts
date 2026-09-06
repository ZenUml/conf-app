import { describe, it, expect, beforeEach, vi } from 'vitest'
import forgeGlobal from '@/model/globals/forgeGlobal'
import {
  deriveUnplacedIdentity,
  hasExhaustedShows,
  isDismissalQuiet,
  DISMISSAL_QUIET_MS,
  MAX_BANNER_SHOWS,
  isUnplacedBannerCandidate,
  parseUnplacedMarker,
  readUnplacedBannerMarker,
  readUnplacedMarker,
  recordUnplacedBannerDismissed,
  recordUnplacedBannerResolved,
  recordUnplacedBannerShown,
  unplacedBannerMarkerKey,
  unplacedMarkerKey,
  writeUnplacedMarker,
  UNPLACED_MARKER_TTL_MS,
} from './unplacedMarker'

const IDENTITY = { clientDomain: 'example-tenant', pageId: '12345' }
const ENTRY = { id: 'cc-1', title: 'Login flow', diagramType: 'sequence' }
const SECOND = { id: 'cc-2', title: 'Retry', diagramType: 'mermaid' }
const NOW = Date.parse('2026-08-20T10:00:00.000Z')
/** The property write was denied, so this marker is the only record there is. */
const FALLBACK = { viaProperty: false }
/** The property carried the verdict; the gated module shows it to everyone. */
const CARRIED = { viaProperty: true }

describe('unplacedMarker — the byline→banner handoff', () => {
  beforeEach(() => {
    window.localStorage.clear()
    ;(forgeGlobal as any).forgeContext = undefined
  })

  describe('identity', () => {
    it('refuses an identity when the page id is unknown', () => {
      ;(forgeGlobal as any).forgeContext = { extension: {} }
      expect(deriveUnplacedIdentity()).toBeNull()
    })

    it('derives domain + page id from the Forge context', () => {
      window.localStorage.setItem('mockClientDomain', 'example-tenant')
      ;(forgeGlobal as any).forgeContext = { extension: { content: { id: 998 } } }
      expect(deriveUnplacedIdentity()).toEqual({ clientDomain: 'example-tenant', pageId: '998' })
    })
  })

  describe('keys', () => {
    it('scopes both keys by domain AND page — a marker must never be read on another page', () => {
      expect(unplacedMarkerKey(IDENTITY)).toBe('bylineUnplaced:example-tenant:12345')
      expect(unplacedBannerMarkerKey(IDENTITY)).toBe('bylineUnplacedBanner:example-tenant:12345')
    })

    it('keeps the two writers on separate keys', () => {
      expect(unplacedMarkerKey(IDENTITY)).not.toBe(unplacedBannerMarkerKey(IDENTITY))
    })
  })

  describe('parsing', () => {
    it('returns null for absent or malformed markers', () => {
      expect(parseUnplacedMarker(null)).toBeNull()
      expect(parseUnplacedMarker('not json')).toBeNull()
      expect(parseUnplacedMarker('{"entries":[]}')).toBeNull()
      expect(parseUnplacedMarker('{"updatedAt":"2026-08-20T10:00:00.000Z"}')).toBeNull()
    })

    it('drops entries with no id rather than surfacing an unlinkable row', () => {
      const marker = parseUnplacedMarker(
        JSON.stringify({ entries: [ENTRY, { title: 'orphan' }], updatedAt: '2026-08-20T10:00:00.000Z' }),
      )
      expect(marker?.entries).toEqual([ENTRY])
    })

    it('tolerates a missing title/type — the banner falls back, it does not fail', () => {
      const marker = parseUnplacedMarker(
        JSON.stringify({ entries: [{ id: 'cc-9' }], updatedAt: '2026-08-20T10:00:00.000Z' }),
      )
      expect(marker?.entries).toEqual([{ id: 'cc-9', title: '', diagramType: '' }])
    })
  })

  describe('writing', () => {
    it('round-trips what the byline observed', () => {
      writeUnplacedMarker(IDENTITY, [ENTRY], FALLBACK, NOW)
      expect(readUnplacedMarker(IDENTITY)).toEqual({
        entries: [ENTRY],
        updatedAt: '2026-08-20T10:00:00.000Z',
        pageId: IDENTITY.pageId,
        viaProperty: false,
      })
    })

    it('writes an EMPTY list rather than skipping — that is what retires a fixed banner', () => {
      writeUnplacedMarker(IDENTITY, [ENTRY], FALLBACK, NOW)
      writeUnplacedMarker(IDENTITY, [], FALLBACK, NOW + 1000)
      expect(readUnplacedMarker(IDENTITY)?.entries).toEqual([])
      expect(isUnplacedBannerCandidate(IDENTITY, NOW + 1000)).toBe(false)
    })

    it('never throws when localStorage is unavailable', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceeded')
      })
      expect(() => writeUnplacedMarker(IDENTITY, [ENTRY], FALLBACK, NOW)).not.toThrow()
      setItem.mockRestore()
    })
  })

  describe('candidate gate', () => {
    it('is false with no marker at all — the ~99.9% page load pays nothing', () => {
      expect(isUnplacedBannerCandidate(IDENTITY, NOW)).toBe(false)
    })

    it('is false without an identity', () => {
      expect(isUnplacedBannerCandidate(null, NOW)).toBe(false)
    })

    it('is true once the byline has reported an unplaced diagram it could not record on the page', () => {
      writeUnplacedMarker(IDENTITY, [ENTRY], FALLBACK, NOW)
      expect(isUnplacedBannerCandidate(IDENTITY, NOW)).toBe(true)
    })

    it('stands down when the content property carried the verdict', () => {
      // The gated `zenuml-unplaced-banner` module shows it — to everyone, not
      // just this browser. Arming the shared host too would stack two banners
      // saying the same thing on one page.
      writeUnplacedMarker(IDENTITY, [ENTRY], CARRIED, NOW)
      expect(isUnplacedBannerCandidate(IDENTITY, NOW)).toBe(false)
    })

    it('will not speak for a marker that does not name the page it is read on', () => {
      // The banner turns this record into "saved on THIS page". A record from
      // another page passes the ADF scan for free — that page's diagram really
      // is not rendered here — so the stamp is the only thing that catches it.
      window.localStorage.setItem(
        unplacedMarkerKey(IDENTITY),
        JSON.stringify({
          entries: [ENTRY],
          updatedAt: new Date(NOW).toISOString(),
          pageId: 'some-other-page',
        }),
      )
      expect(isUnplacedBannerCandidate(IDENTITY, NOW)).toBe(false)
    })

    it('stays silent on a marker written before the page stamp existed', () => {
      // Unverifiable, not trusted: an unstamped record cannot say which page it
      // describes, and the fallback is the minor path — the byline restamps it
      // the next time it is opened.
      window.localStorage.setItem(
        unplacedMarkerKey(IDENTITY),
        JSON.stringify({ entries: [ENTRY], updatedAt: new Date(NOW).toISOString() }),
      )
      expect(isUnplacedBannerCandidate(IDENTITY, NOW)).toBe(false)
    })

    it('expires after the TTL rather than paying an ADF read forever', () => {
      writeUnplacedMarker(IDENTITY, [ENTRY], FALLBACK, NOW)
      expect(isUnplacedBannerCandidate(IDENTITY, NOW + UNPLACED_MARKER_TTL_MS - 1)).toBe(true)
      expect(isUnplacedBannerCandidate(IDENTITY, NOW + UNPLACED_MARKER_TTL_MS + 1)).toBe(false)
    })

    it('stays silent once dismissed for that marker version', () => {
      writeUnplacedMarker(IDENTITY, [ENTRY], FALLBACK, NOW)
      recordUnplacedBannerDismissed(IDENTITY, readUnplacedMarker(IDENTITY)!.updatedAt)
      expect(isUnplacedBannerCandidate(IDENTITY, NOW)).toBe(false)
    })

    it('re-arms when the byline reports again — a dismissal is "not now", not "never"', () => {
      writeUnplacedMarker(IDENTITY, [ENTRY], FALLBACK, NOW)
      recordUnplacedBannerDismissed(IDENTITY, readUnplacedMarker(IDENTITY)!.updatedAt)
      writeUnplacedMarker(IDENTITY, [ENTRY, SECOND], FALLBACK, NOW + 5000)
      expect(isUnplacedBannerCandidate(IDENTITY, NOW + 5000)).toBe(true)
    })

    it('stops verifying once the banner proved the diagrams are placed', () => {
      writeUnplacedMarker(IDENTITY, [ENTRY], FALLBACK, NOW)
      recordUnplacedBannerResolved(IDENTITY, readUnplacedMarker(IDENTITY)!.updatedAt)
      expect(isUnplacedBannerCandidate(IDENTITY, NOW)).toBe(false)
    })

    it('ignores a marker whose timestamp cannot be read', () => {
      window.localStorage.setItem(
        unplacedMarkerKey(IDENTITY),
        JSON.stringify({ entries: [ENTRY], updatedAt: 'whenever' }),
      )
      expect(isUnplacedBannerCandidate(IDENTITY, NOW)).toBe(false)
    })
  })

  describe('bounds on how often one browser is asked', () => {
    it('stops after the cap for the SAME record', () => {
      // Placing the diagram or dismissing the notice ends it properly; the cap
      // only stops a viewer who does neither meeting it on every single load.
      writeUnplacedMarker(IDENTITY, [ENTRY], FALLBACK, NOW)
      const version = readUnplacedMarker(IDENTITY)!.updatedAt
      for (let i = 0; i < MAX_BANNER_SHOWS; i++) {
        expect(hasExhaustedShows(IDENTITY, version)).toBe(false)
        recordUnplacedBannerShown(IDENTITY, version, NOW + i)
      }
      expect(hasExhaustedShows(IDENTITY, version)).toBe(true)
      expect(isUnplacedBannerCandidate(IDENTITY, NOW)).toBe(false)
    })

    it('starts a fresh tally when the record changes', () => {
      writeUnplacedMarker(IDENTITY, [ENTRY], FALLBACK, NOW)
      const first = readUnplacedMarker(IDENTITY)!.updatedAt
      for (let i = 0; i < MAX_BANNER_SHOWS; i++) recordUnplacedBannerShown(IDENTITY, first, NOW)
      expect(hasExhaustedShows(IDENTITY, first)).toBe(true)

      writeUnplacedMarker(IDENTITY, [ENTRY, SECOND], FALLBACK, NOW + 5000)
      const second = readUnplacedMarker(IDENTITY)!.updatedAt
      expect(hasExhaustedShows(IDENTITY, second)).toBe(false)
      expect(isUnplacedBannerCandidate(IDENTITY, NOW + 5000)).toBe(true)
    })

    it('goes quiet for a day after a dismissal, without needing the record', () => {
      // This is the only dismissal check the property path can make BEFORE
      // paying for a REST call.
      expect(isDismissalQuiet(IDENTITY, NOW)).toBe(false)
      recordUnplacedBannerDismissed(IDENTITY, 'v1', NOW)
      expect(isDismissalQuiet(IDENTITY, NOW + DISMISSAL_QUIET_MS - 1)).toBe(true)
      expect(isDismissalQuiet(IDENTITY, NOW + DISMISSAL_QUIET_MS + 1)).toBe(false)
    })

    it('keeps the synchronous gate free of the quiet window', () => {
      // That gate costs nothing, so it keeps the stricter promise: a dismissal
      // is "not now", and a NEW diagram re-arms it the same minute.
      writeUnplacedMarker(IDENTITY, [ENTRY], FALLBACK, NOW)
      recordUnplacedBannerDismissed(IDENTITY, readUnplacedMarker(IDENTITY)!.updatedAt, NOW)
      writeUnplacedMarker(IDENTITY, [ENTRY, SECOND], FALLBACK, NOW + 1000)
      expect(isUnplacedBannerCandidate(IDENTITY, NOW + 1000)).toBe(true)
    })
  })

  describe('banner-side bookkeeping', () => {
    it('counts impressions without disturbing the dismissal', () => {
      writeUnplacedMarker(IDENTITY, [ENTRY], FALLBACK, NOW)
      recordUnplacedBannerShown(IDENTITY, 'v1', NOW)
      recordUnplacedBannerShown(IDENTITY, 'v1', NOW + 1000)
      const banner = readUnplacedBannerMarker(IDENTITY)
      expect(banner.showCount).toBe(2)
      expect(banner.lastShownAt).toBe('2026-08-20T10:00:01.000Z')
      expect(banner.dismissedFor).toBeNull()
    })

    it('defaults to an empty record rather than throwing on corrupt JSON', () => {
      window.localStorage.setItem(unplacedBannerMarkerKey(IDENTITY), '{oops')
      expect(readUnplacedBannerMarker(IDENTITY)).toEqual({
        dismissedFor: null,
        dismissedAt: null,
        resolvedFor: null,
        lastShownAt: null,
        showCount: 0,
        shownFor: null,
      })
    })
  })
})
