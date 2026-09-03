import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'
import { callRemote } from '@/utils/requestUtil'

/**
 * M1 first-seen ping (onboarding spec Phase 1,
 * docs/superpowers/specs — "onboarding redesign", mechanism M1).
 *
 * Problem: the backend learns a tenant's domain only when someone opens a
 * macro. A tenant where nobody ever does stays `clientDomain NULL` forever —
 * 85.7% of post-June Diagramly installs. The page-banner host is the one
 * surface that mounts on EVERY Confluence page load in EVERY variant, so a
 * single throttled authenticated POST from here resolves the domain (the
 * invocation token carries `context.siteUrl`; `/forge-user-behavior` already
 * upserts `AtlassianInstance` from it) and, counted per accountId, doubles as
 * the first census of Confluence-active users per tenant (the P3 denominator).
 *
 * Cost discipline (mirrors utils/paywall/spaceAdminProbe.ts):
 *   - All variants (unlike the admin probe this is NOT Lite-only — the census
 *     is the point, and it must cover Full/Diagramly's silent installs).
 *   - Throttled to once / 30 days per `domain` per browser via a localStorage
 *     marker; the common load exits on the synchronous marker read.
 *   - Null accountId → no POST, no marker, no attempt stamp. Deliberate: the
 *     Phase-1 gate counts installs with human (logged-in) page activity, and
 *     burning the 30-day throttle on a null identity would drop this browser
 *     out of the census for a month. Context init happens on this path anyway,
 *     so retry-next-load is free. Do NOT "fix" this into a POST-on-null.
 *   - Failure backoff via an attempt stamp (userCohorts.ts pattern): a broken
 *     backend must not turn one ping per 30 days into one per page load.
 *
 * Kill switch: the backend may answer `{ disabled: true }` (env-controlled,
 * see functions/forge-user-behavior.ts). The client then writes the marker as
 * if it succeeded — the fleet goes quiet within one page load per browser.
 * Note the kill path is a Cloudflare env change + backend redeploy (Pages
 * bakes env at deploy), not an instant toggle; no Forge flag is spent on this
 * (Lite is at its 10-flag cap).
 */

/** Re-ping the same tenant from the same browser at most once per window. */
export const FIRST_SEEN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/** After any attempt (success or failure), wait this long before retrying. */
export const FIRST_SEEN_RETRY_BACKOFF_MS = 10 * 60 * 1000

export interface FirstSeenMarker {
  sentAt: string
  /** The accountId the ping was sent for — shared-browser mismatches stay detectable. */
  accountId: string
  /** True when the marker was written because the backend reported the feature disabled. */
  disabled?: boolean
}

function keyPart(value: string): string {
  return encodeURIComponent(value || 'unknown')
}

export function firstSeenMarkerKey(clientDomain: string = getClientDomain() || 'unknown'): string {
  // Domain may legitimately be 'unknown' in the banner iframe — do NOT skip the
  // ping for it: the SERVER resolves the real domain from the token's siteUrl;
  // the client-side domain only keys the throttle. Excluding unknown-domain
  // browsers would exclude exactly the census population M1 exists to count.
  return ['appFirstSeen', keyPart(clientDomain)].join(':')
}

function attemptStampKey(clientDomain: string = getClientDomain() || 'unknown'): string {
  return ['appFirstSeenAttempt', keyPart(clientDomain)].join(':')
}

export function parseFirstSeenMarker(raw: string | null): FirstSeenMarker | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<FirstSeenMarker>
    if (typeof p.sentAt !== 'string') return null
    if (typeof p.accountId !== 'string') return null
    const marker: FirstSeenMarker = { sentAt: p.sentAt, accountId: p.accountId }
    if (typeof p.disabled === 'boolean') marker.disabled = p.disabled
    return marker
  } catch {
    return null
  }
}

export function readFirstSeenMarker(clientDomain?: string): FirstSeenMarker | null {
  try {
    return parseFirstSeenMarker(localStorage.getItem(firstSeenMarkerKey(clientDomain)))
  } catch {
    return null
  }
}

/** True when no valid marker exists or the last ping left the 30-day window. Pure. */
export function isFirstSeenDue(marker: FirstSeenMarker | null, now: number = Date.now()): boolean {
  if (!marker) return true
  const sent = Date.parse(marker.sentAt)
  if (!Number.isFinite(sent)) return true
  return now - sent > FIRST_SEEN_WINDOW_MS
}

function writeFirstSeenMarker(now: number, accountId: string, disabled: boolean, clientDomain?: string): void {
  try {
    const marker: FirstSeenMarker = { sentAt: new Date(now).toISOString(), accountId }
    if (disabled) marker.disabled = true
    localStorage.setItem(firstSeenMarkerKey(clientDomain), JSON.stringify(marker))
  } catch (e) {
    console.warn('[first-seen] marker write failed', e)
  }
}

function writeAttemptStamp(now: number, clientDomain?: string): void {
  try {
    localStorage.setItem(attemptStampKey(clientDomain), new Date(now).toISOString())
  } catch (e) {
    console.warn('[first-seen] attempt stamp write failed', e)
  }
}

/** Absence or an unparseable stamp means "no prior attempt" — never back off then. */
export function isWithinFirstSeenBackoff(now: number = Date.now(), clientDomain?: string): boolean {
  try {
    const raw = localStorage.getItem(attemptStampKey(clientDomain))
    if (!raw) return false
    const attemptMs = Date.parse(raw)
    if (!Number.isFinite(attemptMs)) return false
    return now - attemptMs < FIRST_SEEN_RETRY_BACKOFF_MS
  } catch {
    return false
  }
}

/**
 * Send the first-seen ping if due. Safe to call on every page-banner load:
 * short-circuits synchronously on the marker/backoff reads, never throws.
 * MUST be awaited by the caller — `view.close()` aborts in-flight requests
 * (same contract as maybeProbeSpaceAdmin).
 */
export async function maybeSendFirstSeenPing(now: number = Date.now()): Promise<void> {
  try {
    // Cheap synchronous fast-path: already pinged inside the window.
    if (!isFirstSeenDue(readFirstSeenMarker(), now)) return
    if (isWithinFirstSeenBackoff(now)) return

    await globals.apWrapper.initializeContext()

    const accountId = forgeGlobal.forgeContext?.accountId
    if (!accountId) return // census rule: no identity → no POST, no marker, no stamp; retry next load

    writeAttemptStamp(now)

    const response = await callRemote('/forge-user-behavior', 'POST', {
      eventType: 'app_first_seen',
      atlassianId: accountId,
      eventCreatedDate: new Date(now).toISOString(),
    })

    const disabled = !!(response && (response as { disabled?: boolean }).disabled)
    writeFirstSeenMarker(now, accountId, disabled)
  } catch (e) {
    // Swallow: never throw into the page-banner hot path. The attempt stamp
    // (written before the POST) provides the 10-minute backoff; no marker is
    // written, so the next out-of-backoff load retries.
    console.warn('[first-seen] ping failed', e)
  }
}
