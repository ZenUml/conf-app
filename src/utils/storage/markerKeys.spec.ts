import { describe, it, expect, vi, beforeEach } from 'vitest'

// Freezes the exact localStorage key strings of every marker module. A stored
// key is a cross-iframe contract (and a user's saved state): changing one
// silently orphans existing browser data, so any refactor of the key plumbing
// must leave every literal below untouched.

let mockDomain = 'example-tenant'
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => mockDomain,
  getSpaceKey: () => 'SP',
}))
vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

import { callRemote } from '@/utils/requestUtil'
import { unplacedBannerMarkerKey, unplacedMarkerKey } from '@/utils/byline/unplacedMarker'
import { refreshUserCohortsIfStale, userCohortsMarkerKey } from '@/utils/cohorts/userCohorts'
import { continueAttemptsKey } from '@/utils/paywall/continueAttempts'
import { impressionMarkerKey, macroActivityMarkerKey, targetingMarkerKey } from '@/utils/paywall/warningBanner'
import { dismissMarkerKey } from '@/utils/stalenessHint/core'

const WEIRD = 'a:b c/é'
const WEIRD_ENC = 'a%3Ab%20c%2F%C3%A9'
const nil = null as unknown as string
const undef = undefined as unknown as string

describe('marker key formats', () => {
  beforeEach(() => {
    mockDomain = 'example-tenant'
    localStorage.clear()
  })

  it('unplaced byline markers', () => {
    expect(unplacedMarkerKey({ clientDomain: 'example-tenant', pageId: '12345' })).toBe('bylineUnplaced:example-tenant:12345')
    expect(unplacedMarkerKey({ clientDomain: WEIRD, pageId: WEIRD })).toBe(`bylineUnplaced:${WEIRD_ENC}:${WEIRD_ENC}`)
    expect(unplacedMarkerKey({ clientDomain: '', pageId: nil })).toBe('bylineUnplaced:unknown:unknown')
    expect(unplacedMarkerKey({ clientDomain: undef, pageId: '7' })).toBe('bylineUnplaced:unknown:7')
    expect(unplacedBannerMarkerKey({ clientDomain: 'example-tenant', pageId: '12345' })).toBe('bylineUnplacedBanner:example-tenant:12345')
    expect(unplacedBannerMarkerKey({ clientDomain: WEIRD, pageId: WEIRD })).toBe(`bylineUnplacedBanner:${WEIRD_ENC}:${WEIRD_ENC}`)
    expect(unplacedBannerMarkerKey({ clientDomain: '', pageId: undef })).toBe('bylineUnplacedBanner:unknown:unknown')
  })

  it('user cohorts marker', () => {
    expect(userCohortsMarkerKey()).toBe('userCohorts:example-tenant')
    expect(userCohortsMarkerKey(WEIRD)).toBe(`userCohorts:${WEIRD_ENC}`)
    expect(userCohortsMarkerKey('')).toBe('userCohorts:unknown')
    expect(userCohortsMarkerKey(undefined)).toBe('userCohorts:example-tenant')
    mockDomain = ''
    expect(userCohortsMarkerKey()).toBe('userCohorts:unknown')
  })

  it('user cohorts attempt stamp (private builder, observed through a failed refresh)', async () => {
    vi.mocked(callRemote).mockRejectedValue(new Error('boom'))
    mockDomain = WEIRD
    await refreshUserCohortsIfStale(Date.parse('2026-07-18T00:00:00Z'))
    expect(Object.keys(localStorage)).toEqual([`userCohortsAttempt:${WEIRD_ENC}`])
    expect(localStorage.getItem(`userCohortsAttempt:${WEIRD_ENC}`)).toBe('2026-07-18T00:00:00.000Z')
    localStorage.clear()
    mockDomain = ''
    await refreshUserCohortsIfStale(Date.parse('2026-07-18T00:00:00Z'))
    expect(Object.keys(localStorage)).toEqual(['userCohortsAttempt:unknown'])
  })

  it('paywall continue attempts', () => {
    expect(continueAttemptsKey({ clientDomain: 'example-tenant', spaceKey: 'SP', userAccountId: 'acc-1' }))
      .toBe('paywallContinueAttempts:example-tenant:SP:acc-1')
    expect(continueAttemptsKey({ clientDomain: WEIRD, spaceKey: WEIRD, userAccountId: WEIRD }))
      .toBe(`paywallContinueAttempts:${WEIRD_ENC}:${WEIRD_ENC}:${WEIRD_ENC}`)
    expect(continueAttemptsKey({ clientDomain: '', spaceKey: nil, userAccountId: undef }))
      .toBe('paywallContinueAttempts:unknown:unknown:unknown')
  })

  it('paywall warning banner markers', () => {
    const id = { clientDomain: 'example-tenant', spaceKey: 'SP' }
    expect(targetingMarkerKey(id)).toBe('paywallWarning:example-tenant:SP')
    expect(impressionMarkerKey(id)).toBe('paywallBanner:example-tenant:SP')
    expect(macroActivityMarkerKey(id)).toBe('paywallActivity:example-tenant:SP')
    const weird = { clientDomain: WEIRD, spaceKey: WEIRD }
    expect(targetingMarkerKey(weird)).toBe(`paywallWarning:${WEIRD_ENC}:${WEIRD_ENC}`)
    expect(impressionMarkerKey(weird)).toBe(`paywallBanner:${WEIRD_ENC}:${WEIRD_ENC}`)
    expect(macroActivityMarkerKey(weird)).toBe(`paywallActivity:${WEIRD_ENC}:${WEIRD_ENC}`)
    const empty = { clientDomain: '', spaceKey: nil }
    expect(targetingMarkerKey(empty)).toBe('paywallWarning:unknown:unknown')
    expect(impressionMarkerKey(empty)).toBe('paywallBanner:unknown:unknown')
    expect(macroActivityMarkerKey(empty)).toBe('paywallActivity:unknown:unknown')
  })

  it('staleness hint dismiss marker', () => {
    expect(dismissMarkerKey('cc-1')).toBe('stalenessHint:example-tenant:cc-1')
    expect(dismissMarkerKey(WEIRD, WEIRD)).toBe(`stalenessHint:${WEIRD_ENC}:${WEIRD_ENC}`)
    expect(dismissMarkerKey('', '')).toBe('stalenessHint:unknown:unknown')
    expect(dismissMarkerKey(nil, undefined)).toBe('stalenessHint:example-tenant:unknown')
    mockDomain = ''
    expect(dismissMarkerKey('cc-1')).toBe('stalenessHint:unknown:cc-1')
  })
})
