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
  /**
   * Phase 5b: the admin verdict, persisted so the page banner's SYNCHRONOUS
   * visibility gate can read it. Firing `space_admin_active` is not enough —
   * that event leaves the browser and never comes back. Absent on Phase-5a-era
   * markers, which is why {@link isProbeDue} treats a verdict-less marker as
   * due (see there).
   */
  isAdmin?: boolean
  /** Size of the resolved admin list, for the same reason. */
  adminCount?: number
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
    const marker: SpaceAdminProbeMarker = { lastProbedAt: p.lastProbedAt }
    // A malformed verdict is dropped rather than rejecting the whole marker: the
    // result is a verdict-less marker, which is already the legacy shape and is
    // handled (re-probe, banner stays editor-only until then).
    if (typeof p.isAdmin === 'boolean') marker.isAdmin = p.isAdmin
    if (typeof p.adminCount === 'number' && Number.isFinite(p.adminCount)) {
      marker.adminCount = Math.floor(p.adminCount)
    }
    return marker
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

/** True when no marker exists, the marker is unparseable, it carries no admin
 * verdict, or it is older than the 30-day window. Pure — the throttle gate the
 * hot path checks before any init. */
export function isProbeDue(marker: SpaceAdminProbeMarker | null, now: number = Date.now()): boolean {
  if (!marker) return true
  // Phase 5b schema upgrade: a Phase-5a marker records only that we probed, not
  // what we found. Honouring its throttle would keep every already-probed admin
  // invisible to the banner for up to 30 days after release, so re-probe once.
  if (typeof marker.isAdmin !== 'boolean') return true
  const last = Date.parse(marker.lastProbedAt)
  if (!Number.isFinite(last)) return true
  return now - last > SPACE_ADMIN_PROBE_WINDOW_MS
}

/**
 * Is the current user a space admin of the current space, per the last probe?
 *
 * Synchronous by design: the page banner decides visibility in `setup()`, before
 * any await, so this reads the persisted verdict rather than resolving admins.
 * Fails closed (false) on a missing, legacy, or unreadable marker — the banner
 * then behaves exactly as it did before Phase 5b.
 *
 * A verdict past the 30-day window is still returned. It is corrected by the
 * probe running on this same page load; suppressing the banner for a known admin
 * in the meantime is the worse error.
 */
export function isCurrentUserSpaceAdmin(
  identity: WarningBannerIdentity = deriveWarningBannerIdentity()
): boolean {
  return readProbeMarker(identity)?.isAdmin === true
}

/** Best-effort write; never throws into the banner path. */
function writeProbeMarker(
  identity: WarningBannerIdentity,
  now: number,
  isAdmin: boolean,
  adminCount: number
): void {
  try {
    const marker: SpaceAdminProbeMarker = {
      lastProbedAt: new Date(now).toISOString(),
      isAdmin,
      adminCount,
    }
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

    const isAdmin = admins.some((a) => a.id === accountId)

    // Success → throttle for the window regardless of admin/non-admin outcome,
    // and persist the verdict for the banner's synchronous gate (Phase 5b).
    writeProbeMarker(identity, now, isAdmin, admins.length)

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
