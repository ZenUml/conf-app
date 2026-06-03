import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { deriveWarningBannerIdentity, type WarningBannerIdentity } from '@/utils/paywall/warningBanner'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { SpaceAdmin } from '@/model/SpaceAdmin'

/**
 * Phase 5a measurement: is the current user a space admin, and are admins active
 * on Confluence at all? Before we build admin-specific paywall copy (Phase 5b),
 * we first need to know admins actually load Confluence pages on our Lite
 * installs. This probe runs from the page-banner host (`confluence:pageBanner`),
 * which mounts on EVERY Confluence page load — not just pages with our macros —
 * so it observes admin activity across Confluence, the "not necessarily our app"
 * signal Phase 5b depends on.
 *
 * Cost discipline:
 *   - Lite only (the paywall is Lite-only; no point paying REST on Full/Diagramly).
 *   - Throttled to once / 30 days per `domain:space` via a localStorage marker, so
 *     resolving the admin list (~4+ Confluence REST calls) happens at most once a
 *     month per space per browser. The vast majority of loads short-circuit on the
 *     synchronous marker read before any context init or network call.
 *
 * Key scope (`domain:space`, no accountId): identical rationale to warningBanner.ts
 * — the page-banner iframe cannot read accountId synchronously, and localStorage is
 * already per-browser (≈ per-user). accountId IS resolved async (post-init) for the
 * admin-membership check; it is only the synchronous throttle key that omits it.
 *
 * Fire policy: emit `space_admin_active` ONLY when the current user is an admin.
 * The throttle marker is written for admins AND non-admins alike (any successful
 * resolution), so non-admins — the majority — don't re-pay the REST cost every load.
 */

/** Re-report the same domain:space at most once per this window. */
export const SPACE_ADMIN_PROBE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export interface SpaceAdminProbeMarker {
  lastProbedAt: string
}

function probeMarkerKeyPart(value: string): string {
  return encodeURIComponent(value || 'unknown')
}

export function spaceAdminProbeKey(identity: WarningBannerIdentity): string {
  return [
    'paywallAdminProbe',
    probeMarkerKeyPart(identity.clientDomain),
    probeMarkerKeyPart(identity.spaceKey),
  ].join(':')
}

export function parseProbeMarker(raw: string | null): SpaceAdminProbeMarker | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<SpaceAdminProbeMarker>
    if (typeof p.lastProbedAt !== 'string') return null
    return { lastProbedAt: p.lastProbedAt }
  } catch {
    return null
  }
}

export function readProbeMarker(
  identity: WarningBannerIdentity = deriveWarningBannerIdentity()
): SpaceAdminProbeMarker | null {
  try {
    return parseProbeMarker(localStorage.getItem(spaceAdminProbeKey(identity)))
  } catch {
    return null
  }
}

/** True when no marker exists, the marker is unparseable, or it is older than the
 * 30-day window. Pure — the throttle gate the hot path checks before any init. */
export function isProbeDue(marker: SpaceAdminProbeMarker | null, now: number = Date.now()): boolean {
  if (!marker) return true
  const last = Date.parse(marker.lastProbedAt)
  if (!Number.isFinite(last)) return true
  return now - last > SPACE_ADMIN_PROBE_WINDOW_MS
}

/** Best-effort write; never throws into the banner path. */
function writeProbeMarker(identity: WarningBannerIdentity, now: number): void {
  try {
    const marker: SpaceAdminProbeMarker = { lastProbedAt: new Date(now).toISOString() }
    localStorage.setItem(spaceAdminProbeKey(identity), JSON.stringify(marker))
  } catch (e) {
    console.warn('[space-admin-probe] marker write failed', e)
  }
}

function isLiteVariant(): boolean {
  // Build-time constant (mirrors _getProductType in trackAnalyticsEvent.ts); does
  // not depend on Forge context being initialized, so it is safe on the hot path.
  return import.meta.env.PRODUCT_TYPE === 'lite'
}

/**
 * Detect whether the current user is a space admin and, when so, fire
 * `space_admin_active`. Safe to call on every page-banner load: it short-circuits
 * synchronously on non-Lite variants, missing identity, and the 30-day throttle,
 * and never throws (any storage/REST error is swallowed, leaving no marker so the
 * next load retries).
 */
export async function maybeProbeSpaceAdmin(now: number = Date.now()): Promise<void> {
  try {
    if (!isLiteVariant()) return

    const identity = deriveWarningBannerIdentity()
    if (identity.clientDomain === 'unknown' || identity.spaceKey === 'unknown') return

    // Cheap synchronous fast-path: the common case (already probed in window) exits
    // here, before any context init or REST call.
    if (!isProbeDue(readProbeMarker(identity), now)) return

    await globals.apWrapper.initializeContext()

    const accountId = forgeGlobal.forgeContext?.accountId
    if (!accountId) return // can't determine membership; no marker → retry next load

    const admins = (await globals.apWrapper.getCurrentSpaceAdmins()) as SpaceAdmin[] | undefined
    if (!admins) return // resolver failed; no marker → retry next load

    // Success → throttle for the window regardless of admin/non-admin outcome.
    writeProbeMarker(identity, now)

    const isAdmin = admins.some((a) => a.id === accountId)
    if (isAdmin) {
      trackAnalyticsEvent('space_admin_active', {
        feature_area: 'upgrade',
        surface: 'page_banner',
        is_space_admin: true,
        space_admin_count: admins.length,
      })
    }
  } catch (e) {
    console.warn('[space-admin-probe] failed', e)
    // Swallow: never throw into the page-banner hot path. No marker written on
    // throw, so a transient failure retries on the next load.
  }
}
