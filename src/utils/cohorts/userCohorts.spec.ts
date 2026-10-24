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
  COHORT_RETRY_BACKOFF_MS,
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

  it('tracks storage_write_failed and no success event when the marker write throws', async () => {
    vi.mocked(callRemote).mockResolvedValue({ cohorts: ['vs-copier'], accountId: 'a-1' })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    try {
      await refreshUserCohortsIfStale(NOW)
    } finally {
      setItem.mockRestore()
      warnSpy.mockRestore()
    }
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('cohorts_refresh_failed', {
      feature_area: 'system',
      surface: 'viewer',
      failure_reason: 'storage_write_failed',
    })
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('cohorts_refreshed', expect.anything())
  })

  it('dedupes concurrent refreshes into a single in-flight request', async () => {
    let resolveCall: (value: unknown) => void = () => {}
    vi.mocked(callRemote).mockImplementation(
      () => new Promise((resolve) => { resolveCall = resolve })
    )

    const p1 = refreshUserCohortsIfStale(NOW)
    const p2 = refreshUserCohortsIfStale(NOW)

    resolveCall({ cohorts: ['vs-copier'], accountId: 'a-1' })
    await Promise.all([p1, p2])

    expect(callRemote).toHaveBeenCalledTimes(1)
    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('cohorts_refreshed', {
      feature_area: 'system',
      surface: 'viewer',
      cohorts: 'vs-copier',
      cohort_count: 1,
    })
  })

  it('does not refetch immediately after a failed refresh (backoff)', async () => {
    vi.mocked(callRemote).mockRejectedValueOnce(new Error('HTTP 500'))
    await refreshUserCohortsIfStale(NOW)
    expect(callRemote).toHaveBeenCalledTimes(1)

    await refreshUserCohortsIfStale(NOW + 1000)
    expect(callRemote).toHaveBeenCalledTimes(1)
  })

  it('retries once the backoff window has elapsed', async () => {
    vi.mocked(callRemote).mockRejectedValueOnce(new Error('HTTP 500'))
    await refreshUserCohortsIfStale(NOW)
    expect(callRemote).toHaveBeenCalledTimes(1)

    vi.mocked(callRemote).mockResolvedValueOnce({ cohorts: ['vs-copier'], accountId: 'a-1' })
    await refreshUserCohortsIfStale(NOW + COHORT_RETRY_BACKOFF_MS + 1)
    expect(callRemote).toHaveBeenCalledTimes(2)
  })
})
