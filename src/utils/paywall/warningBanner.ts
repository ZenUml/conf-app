import { getClientDomain, getSpaceKey } from '@/utils/ContextParameters/ContextParameters'

/**
 * Shared marker module for the paywall page-banner (Phase 3 redesign).
 *
 * Three single-writer localStorage markers coordinate the iframes that can
 * never call each other directly:
 *
 *   - TARGETING marker (`paywallWarning:<domain>:<space>`) — written ONLY by the
 *     macro iframe (useCustomerSuccessService) when a macro renders. Records the
 *     space's computed severity / macro count / paid status / effective paywall
 *     state (legacy field name `customerSuccessServiceEnabled` — since the
 *     lite-paywall-default-on change this is the EFFECTIVE decision, `true`
 *     only when `paywallPolicySource` is 'default_on'; a domain/wildcard
 *     exemption or a fail-open lookup both write `false`, same as the old
 *     "not CSS-enrolled" case).
 *   - DISMISSAL marker (`paywallBanner:<domain>:<space>`) — written ONLY by the
 *     page-banner iframe. Records show count + the last dismissal timestamp.
 *   - ACTIVITY marker (`paywallActivity:<domain>:<space>`) — written by editor
 *     save paths after a successful create/edit. Records the user's latest
 *     macro-authoring activity in this browser profile.
 *
 * Single-writer-per-key avoids the read-modify-write clobber two iframes would
 * otherwise hit on a shared key. The banner's visibility is decided purely from
 * these markers (no backend call), the same fast-exit discipline as CSAT.
 *
 * Scope deviation from the design doc (2026-06-02): keys are scoped by
 * `domain:space` only, NOT `domain:space:accountId`. The page-banner (read)
 * iframe cannot reliably read `accountId` from its Forge context synchronously
 * — CSAT pays for an async `_getCurrentUser()` precisely because of this — so an
 * accountId-keyed read would build `...:unknown` while the macro-side write used
 * a real id, and the keys would never match (silent never-show). localStorage is
 * already per-browser, hence effectively per-user; accountId in the key would
 * only disambiguate multiple Atlassian accounts sharing one browser profile
 * (negligible for v1). Dropping it keeps the entire gate synchronous.
 */

/** Snooze window for a dismissed warning banner. */
export const WARNING_BANNER_SUPPRESSION_MS = 7 * 24 * 60 * 60 * 1000
export const RECENT_MACRO_ACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
export const PAYWALL_BANNER_MIN_MACRO_COUNT = 100

/** Marker severity. 'none' is the inactive state the macro side writes when the
 * space falls below the warning band; the composable's own `severity` computed
 * uses 'normal' for that band — map via {@link toMarkerSeverity}. */
export type WarningSeverity = 'none' | 'warning' | 'critical'
export type MacroActivityType = 'create' | 'edit'

export interface WarningBannerIdentity {
  clientDomain: string
  spaceKey: string
}

export interface TargetingMarker {
  severity: WarningSeverity
  macroCount: number
  spacePaid: boolean
  /** Legacy field name; holds the EFFECTIVE Lite paywall-enabled boolean
   * (see the module doc comment above), not a raw CSS flag read. */
  customerSuccessServiceEnabled: boolean
  updatedAt: string
}

export interface MacroActivityMarker {
  lastActivityAt: string
  activityType: MacroActivityType
}

export interface DismissalMarker {
  dismissedAt: string | null
  lastShownAt: string | null
  showCount: number
}

/** encodeURIComponent + 'unknown' fallback, mirroring continueAttempts.ts so the
 * macro-side write and banner-side read derive byte-identical keys. */
function normalizeKeyPart(value: string): string {
  return encodeURIComponent(value || 'unknown')
}

/**
 * Derive the shared identity from the Forge context. Both the macro iframe
 * (write) and the page-banner iframe (read) call this so any divergence in any
 * part — which would silently break the never-show — is impossible by
 * construction. `getSpaceKey()` is the single source for the space part on both
 * sides.
 */
export function deriveWarningBannerIdentity(): WarningBannerIdentity {
  return {
    clientDomain: getClientDomain() || 'unknown',
    spaceKey: getSpaceKey() || 'unknown',
  }
}

export function targetingMarkerKey(identity: WarningBannerIdentity): string {
  return ['paywallWarning', normalizeKeyPart(identity.clientDomain), normalizeKeyPart(identity.spaceKey)].join(':')
}

export function dismissalMarkerKey(identity: WarningBannerIdentity): string {
  return ['paywallBanner', normalizeKeyPart(identity.clientDomain), normalizeKeyPart(identity.spaceKey)].join(':')
}

export function macroActivityMarkerKey(identity: WarningBannerIdentity): string {
  return ['paywallActivity', normalizeKeyPart(identity.clientDomain), normalizeKeyPart(identity.spaceKey)].join(':')
}

export function parseTargetingMarker(raw: string | null): TargetingMarker | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<TargetingMarker>
    if (p.severity !== 'none' && p.severity !== 'warning' && p.severity !== 'critical') return null
    if (typeof p.macroCount !== 'number' || !Number.isFinite(p.macroCount)) return null
    if (typeof p.spacePaid !== 'boolean') return null
    if (typeof p.customerSuccessServiceEnabled !== 'boolean') return null
    if (typeof p.updatedAt !== 'string') return null
    return {
      severity: p.severity,
      macroCount: Math.floor(p.macroCount),
      spacePaid: p.spacePaid,
      customerSuccessServiceEnabled: p.customerSuccessServiceEnabled,
      updatedAt: p.updatedAt,
    }
  } catch {
    return null
  }
}

export function parseMacroActivityMarker(raw: string | null): MacroActivityMarker | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<MacroActivityMarker>
    if (p.activityType !== 'create' && p.activityType !== 'edit') return null
    if (typeof p.lastActivityAt !== 'string') return null
    return {
      lastActivityAt: p.lastActivityAt,
      activityType: p.activityType,
    }
  } catch {
    return null
  }
}

export function parseDismissalMarker(raw: string | null): DismissalMarker | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<DismissalMarker>
    if (typeof p !== 'object' || p === null) return null
    return {
      dismissedAt: typeof p.dismissedAt === 'string' ? p.dismissedAt : null,
      lastShownAt: typeof p.lastShownAt === 'string' ? p.lastShownAt : null,
      showCount:
        typeof p.showCount === 'number' && Number.isFinite(p.showCount) && p.showCount >= 0
          ? Math.floor(p.showCount)
          : 0,
    }
  } catch {
    return null
  }
}

export function readTargetingMarker(identity: WarningBannerIdentity = deriveWarningBannerIdentity()): TargetingMarker | null {
  try {
    return parseTargetingMarker(localStorage.getItem(targetingMarkerKey(identity)))
  } catch {
    return null
  }
}

export function readMacroActivityMarker(identity: WarningBannerIdentity = deriveWarningBannerIdentity()): MacroActivityMarker | null {
  try {
    return parseMacroActivityMarker(localStorage.getItem(macroActivityMarkerKey(identity)))
  } catch {
    return null
  }
}

/** Best-effort write from the macro iframe. Never throws into the render path. */
export function writeTargetingMarker(
  marker: TargetingMarker,
  identity: WarningBannerIdentity = deriveWarningBannerIdentity()
): void {
  try {
    localStorage.setItem(targetingMarkerKey(identity), JSON.stringify(marker))
  } catch (e) {
    console.warn('[paywall-banner] targeting marker write failed', e)
  }
}

export function markRecentMacroActivity(
  activityType: MacroActivityType,
  identity: WarningBannerIdentity = deriveWarningBannerIdentity(),
  now: Date = new Date()
): void {
  try {
    const marker: MacroActivityMarker = {
      lastActivityAt: now.toISOString(),
      activityType,
    }
    localStorage.setItem(macroActivityMarkerKey(identity), JSON.stringify(marker))
  } catch (e) {
    console.warn('[paywall-banner] activity marker write failed', e)
  }
}

export function readDismissalMarker(identity: WarningBannerIdentity = deriveWarningBannerIdentity()): DismissalMarker | null {
  try {
    return parseDismissalMarker(localStorage.getItem(dismissalMarkerKey(identity)))
  } catch {
    return null
  }
}

/** Best-effort write from the banner iframe. Never throws into the banner path. */
function writeDismissalMarker(marker: DismissalMarker, identity: WarningBannerIdentity): void {
  try {
    localStorage.setItem(dismissalMarkerKey(identity), JSON.stringify(marker))
  } catch (e) {
    console.warn('[paywall-banner] dismissal marker write failed', e)
  }
}

/** Which gate admitted the banner, and therefore which copy the user sees. */
export type BannerAudience = 'editor' | 'space_admin'

/** A user who is both an author and a space admin is the stronger audience:
 * they can resolve the limit themselves, so they get the purchase copy rather
 * than the "ask an admin" copy. */
export function bannerAudience(isSpaceAdmin: boolean): BannerAudience {
  return isSpaceAdmin ? 'space_admin' : 'editor'
}

/**
 * Pure visibility gate. Show iff: a targeting marker exists, the CSS feature is
 * enabled for the client, the space is unpaid and over the hard limit, the
 * banner is not inside its snooze window, AND the user is a valid audience —
 * either they created/edited a macro recently, or (Phase 5b) they are a space
 * admin of this over-limit space.
 *
 * The recent-authorship requirement exists to avoid nagging passers-by. It has
 * the side effect of excluding space admins who don't draw diagrams — the people
 * on the page most able to resolve the limit. Measured 2026-07-28 over 60d across
 * the 19 CSS tenants: the authorship gate reached 358 unique users (exact, that
 * event is unsampled), while `space_admin_active` observed 5,021 unique admins
 * already loading this very iframe and being told nothing — a 10%-sampled FLOOR,
 * and one that also counts personal spaces, so treat it as evidence of a large
 * gap rather than as a population estimate. `isSpaceAdmin` waives authorship, and
 * nothing else; the over-limit/unpaid/CSS gates below keep the targeting narrow.
 */
export function isWarningBannerVisible(
  targeting: TargetingMarker | null,
  dismissal: DismissalMarker | null,
  activity: MacroActivityMarker | null,
  now: number = Date.now(),
  isSpaceAdmin = false
): boolean {
  if (!targeting) return false
  if (!targeting.customerSuccessServiceEnabled) return false
  if (targeting.spacePaid) return false
  if (targeting.macroCount <= PAYWALL_BANNER_MIN_MACRO_COUNT) return false
  if (!isSpaceAdmin) {
    if (!activity?.lastActivityAt) return false
    const activityMs = Date.parse(activity.lastActivityAt)
    if (!Number.isFinite(activityMs) || now - activityMs > RECENT_MACRO_ACTIVITY_WINDOW_MS) return false
  }
  if (dismissal?.dismissedAt) {
    const dismissedMs = Date.parse(dismissal.dismissedAt)
    if (Number.isFinite(dismissedMs) && now - dismissedMs <= WARNING_BANNER_SUPPRESSION_MS) {
      return false
    }
  }
  return true
}

/** localStorage-backed gate used by the forgeIndex fast-exit and the CSAT defer
 * check. Fail closed (no banner) on any storage error.
 *
 * `isSpaceAdmin` is a parameter rather than a lookup so this module stays free
 * of any dependency on spaceAdminProbe, which imports from here — the caller
 * resolves it with `isCurrentUserSpaceAdmin()`. */
export function shouldShowPaywallBanner(
  now: number = Date.now(),
  identity: WarningBannerIdentity = deriveWarningBannerIdentity(),
  isSpaceAdmin = false
): boolean {
  // readTargetingMarker / readDismissalMarker / readMacroActivityMarker each
  // fail closed (catch internally, return null) and isWarningBannerVisible is
  // pure — nothing here can throw, so no outer try/catch is needed.
  return isWarningBannerVisible(
    readTargetingMarker(identity),
    readDismissalMarker(identity),
    readMacroActivityMarker(identity),
    now,
    isSpaceAdmin
  )
}

/** Record an impression: bump showCount, stamp lastShownAt, preserve dismissedAt. */
export function recordBannerShown(
  identity: WarningBannerIdentity = deriveWarningBannerIdentity(),
  now: Date = new Date()
): DismissalMarker {
  const current = readDismissalMarker(identity)
  const next: DismissalMarker = {
    dismissedAt: current?.dismissedAt ?? null,
    lastShownAt: now.toISOString(),
    showCount: (current?.showCount ?? 0) + 1,
  }
  writeDismissalMarker(next, identity)
  return next
}

/** Record a dismissal: stamp dismissedAt (starts the snooze), preserve counters. */
export function recordBannerDismissed(
  identity: WarningBannerIdentity = deriveWarningBannerIdentity(),
  now: Date = new Date()
): DismissalMarker {
  const current = readDismissalMarker(identity)
  const next: DismissalMarker = {
    dismissedAt: now.toISOString(),
    lastShownAt: current?.lastShownAt ?? null,
    showCount: current?.showCount ?? 0,
  }
  writeDismissalMarker(next, identity)
  return next
}

/** Map the composable's `severity` band ('normal' | 'warning' | 'critical') to
 * the marker's severity ('none' | 'warning' | 'critical'). */
export function toMarkerSeverity(severity: string): WarningSeverity {
  if (severity === 'warning') return 'warning'
  if (severity === 'critical') return 'critical'
  return 'none'
}
