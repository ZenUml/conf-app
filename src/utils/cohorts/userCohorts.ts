import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'
import { callRemote } from '@/utils/requestUtil'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

/**
 * User-cohort marker (targeting pipeline —
 * docs/superpowers/plans/2026-07-18-user-cohort-targeting-pipeline.md).
 *
 * Single-writer localStorage marker, same discipline as
 * utils/paywall/warningBanner.ts: the macro iframe (the only iframe with a
 * full Forge context) fetches /api/user-cohorts at most once per TTL and
 * writes `userCohorts:<domain>`; other iframes (page banner, upgrade modal)
 * read it synchronously. Domain-scoped, NOT accountId-scoped: the page-banner
 * iframe cannot read accountId synchronously (see warningBanner.ts header),
 * and localStorage is per-browser ≈ per-user. The server still resolves
 * cohorts strictly by the token's accountId; the marker records which
 * accountId it was fetched for, so a shared-browser mismatch is detectable.
 */

export const COHORT_MARKER_TTL_MS = 24 * 60 * 60 * 1000

export interface UserCohortsMarker {
  cohorts: string[]
  accountId: string
  fetchedAt: string
}

function normalizeKeyPart(value: string): string {
  return encodeURIComponent(value || 'unknown')
}

export function userCohortsMarkerKey(clientDomain: string = getClientDomain() || 'unknown'): string {
  return ['userCohorts', normalizeKeyPart(clientDomain)].join(':')
}

export function parseUserCohortsMarker(raw: string | null): UserCohortsMarker | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<UserCohortsMarker>
    if (!Array.isArray(p.cohorts) || p.cohorts.some((c) => typeof c !== 'string')) return null
    if (typeof p.accountId !== 'string') return null
    if (typeof p.fetchedAt !== 'string') return null
    return { cohorts: p.cohorts, accountId: p.accountId, fetchedAt: p.fetchedAt }
  } catch {
    return null
  }
}

export function isMarkerStale(marker: UserCohortsMarker | null, now: number = Date.now()): boolean {
  if (!marker) return true
  const fetchedMs = Date.parse(marker.fetchedAt)
  if (!Number.isFinite(fetchedMs)) return true
  return now - fetchedMs > COHORT_MARKER_TTL_MS
}

export function readUserCohortsMarker(clientDomain?: string): UserCohortsMarker | null {
  try {
    return parseUserCohortsMarker(localStorage.getItem(userCohortsMarkerKey(clientDomain)))
  } catch {
    return null
  }
}

function writeUserCohortsMarker(marker: UserCohortsMarker, clientDomain?: string): void {
  try {
    localStorage.setItem(userCohortsMarkerKey(clientDomain), JSON.stringify(marker))
  } catch (e) {
    console.warn('[cohorts] marker write failed', e)
  }
}

/** Synchronous membership check for hot paths (page banner, upgrade modal).
 * A stale marker still answers — staleness only drives refresh, never reads. */
export function isInCohort(cohort: string): boolean {
  const marker = readUserCohortsMarker()
  return !!marker && marker.cohorts.includes(cohort)
}

/**
 * Refresh the marker from the backend if it is missing/stale. Never throws
 * and never blocks a render path — callers fire-and-forget (`void refresh…`).
 */
export async function refreshUserCohortsIfStale(now: number = Date.now()): Promise<void> {
  if (!isMarkerStale(readUserCohortsMarker(), now)) return
  try {
    const response = await callRemote('/api/user-cohorts', 'GET')
    if (!response || !Array.isArray(response.cohorts)) {
      trackAnalyticsEvent('cohorts_refresh_failed', {
        feature_area: 'system',
        surface: 'viewer',
        failure_reason: 'malformed_response',
      })
      return
    }
    const cohorts = (response.cohorts as unknown[]).filter((c): c is string => typeof c === 'string')
    writeUserCohortsMarker({
      cohorts,
      accountId: typeof response.accountId === 'string' ? response.accountId : 'unknown',
      fetchedAt: new Date(now).toISOString(),
    })
    trackAnalyticsEvent('cohorts_refreshed', {
      feature_area: 'system',
      surface: 'viewer',
      cohorts: cohorts.join(','),
      cohort_count: cohorts.length,
    })
  } catch (e) {
    trackAnalyticsEvent('cohorts_refresh_failed', {
      feature_area: 'system',
      surface: 'viewer',
      failure_reason: e instanceof Error ? e.message : 'unknown',
    })
  }
}
