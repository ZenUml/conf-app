import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}))
vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

import { callRemote } from '@/utils/requestUtil'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import {
  COHORT_MARKER_TTL_MS,
  userCohortsMarkerKey,
  parseUserCohortsMarker,
  isMarkerStale,
  readUserCohortsMarker,
  isInCohort,
  refreshUserCohortsIfStale,
} from './userCohorts'

const NOW = Date.parse('2026-07-18T00:00:00Z')

function seedMarker(fetchedAt: string, cohorts: string[] = ['vs-copier']) {
  localStorage.setItem(
    userCohortsMarkerKey(),
    JSON.stringify({ cohorts, accountId: 'a-1', fetchedAt })
  )
}

describe('userCohorts marker', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.clearAllMocks())

  it('derives a domain-scoped key', () => {
    expect(userCohortsMarkerKey()).toBe('userCohorts:example-tenant')
  })

  it('parses a valid marker and rejects malformed ones', () => {
    expect(parseUserCohortsMarker(JSON.stringify({ cohorts: ['a'], accountId: 'x', fetchedAt: 't' })))
      .toEqual({ cohorts: ['a'], accountId: 'x', fetchedAt: 't' })
    expect(parseUserCohortsMarker(null)).toBeNull()
    expect(parseUserCohortsMarker('not json')).toBeNull()
    expect(parseUserCohortsMarker(JSON.stringify({ cohorts: 'nope', accountId: 'x', fetchedAt: 't' }))).toBeNull()
    expect(parseUserCohortsMarker(JSON.stringify({ cohorts: [1], accountId: 'x', fetchedAt: 't' }))).toBeNull()
  })

  it('isMarkerStale: null, unparseable date, and expired TTL are stale; fresh is not', () => {
    expect(isMarkerStale(null, NOW)).toBe(true)
    expect(isMarkerStale({ cohorts: [], accountId: 'x', fetchedAt: 'garbage' }, NOW)).toBe(true)
    const old = new Date(NOW - COHORT_MARKER_TTL_MS - 1).toISOString()
    expect(isMarkerStale({ cohorts: [], accountId: 'x', fetchedAt: old }, NOW)).toBe(true)
    const fresh = new Date(NOW - 1000).toISOString()
    expect(isMarkerStale({ cohorts: [], accountId: 'x', fetchedAt: fresh }, NOW)).toBe(false)
  })

  it('isInCohort reads synchronously from localStorage, stale or not', () => {
    seedMarker(new Date(NOW - COHORT_MARKER_TTL_MS * 10).toISOString())
    expect(isInCohort('vs-copier')).toBe(true)
    expect(isInCohort('other')).toBe(false)
    localStorage.clear()
    expect(isInCohort('vs-copier')).toBe(false)
  })

  it('refreshUserCohortsIfStale skips the fetch when the marker is fresh', async () => {
    seedMarker(new Date(NOW - 1000).toISOString())
    await refreshUserCohortsIfStale(NOW)
    expect(callRemote).not.toHaveBeenCalled()
  })

  it('refreshUserCohortsIfStale fetches, writes the marker, and tracks success', async () => {
    vi.mocked(callRemote).mockResolvedValue({ cohorts: ['t1-lapsed-author-strict'], accountId: 'a-9' })
    await refreshUserCohortsIfStale(NOW)
    expect(callRemote).toHaveBeenCalledWith('/api/user-cohorts', 'GET')
    expect(readUserCohortsMarker()).toEqual({
      cohorts: ['t1-lapsed-author-strict'],
      accountId: 'a-9',
      fetchedAt: new Date(NOW).toISOString(),
    })
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('cohorts_refreshed', {
      feature_area: 'system',
      surface: 'viewer',
      cohorts: 't1-lapsed-author-strict',
      cohort_count: 1,
    })
  })

  it('refreshUserCohortsIfStale tracks failure and leaves no marker on malformed response', async () => {
    vi.mocked(callRemote).mockResolvedValue({ nope: true })
    await refreshUserCohortsIfStale(NOW)
    expect(readUserCohortsMarker()).toBeNull()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('cohorts_refresh_failed', {
      feature_area: 'system',
      surface: 'viewer',
      failure_reason: 'malformed_response',
    })
  })

  it('refreshUserCohortsIfStale never throws on network error', async () => {
    vi.mocked(callRemote).mockRejectedValue(new Error('HTTP 500'))
    await expect(refreshUserCohortsIfStale(NOW)).resolves.toBeUndefined()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('cohorts_refresh_failed', {
      feature_area: 'system',
      surface: 'viewer',
      failure_reason: 'HTTP 500',
    })
  })
})
