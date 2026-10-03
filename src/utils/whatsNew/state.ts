import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'
import { normalizeProductType, type ProductType } from '@/utils/analytics/productType'
import { currentRelease, WHATS_NEW_RELEASES, type WhatsNewRelease } from './releases'

/**
 * Cross-iframe state for the "What's new" page banner.
 *
 * The page-banner host decides on EVERY Confluence page load, synchronously and
 * from localStorage only, whether to show anything (routes/pageBanner.ts). This
 * module is that decision's "What's new" half. Same shape as the paywall and
 * unplaced markers: the macro iframe and the banner iframe share this app's
 * Forge CDN origin, never call each other, and leave facts for each other.
 *
 * Two keys, ONE WRITER EACH:
 *
 *   - AUDIENCE marker (`whatsNewAudience:<domain>`) — written ONLY by macro
 *     renders (forgeIndex.ts). Its presence means "this browser has seen one of
 *     our diagrams on this site recently". The banner mounts on every page,
 *     including for people who have never touched ZenUML; announcing features
 *     of an app to someone who does not use it is noise.
 *   - BANNER record (`whatsNewBanner:<domain>`) — written ONLY by the banner.
 *     Which release it last showed, how many times, and whether it was
 *     dismissed. One record, not one per release: only the current release
 *     matters, and a new release id simply resets it.
 *
 * Scope is per browser per site, like every other banner marker here —
 * localStorage is per-browser ≈ per-user (see utils/cohorts/userCohorts.ts).
 */

/** Impressions per release per browser before the strip stops on its own. */
export const WHATS_NEW_MAX_SHOWS = 3

/** An audience marker older than this no longer counts as "uses ZenUML". */
export const WHATS_NEW_AUDIENCE_TTL_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Rewrite the audience marker at most this often. Every macro render calls the
 * writer; without a floor, a page of twenty diagrams would be twenty writes.
 */
export const WHATS_NEW_AUDIENCE_REFRESH_MS = 24 * 60 * 60 * 1000

export interface WhatsNewBannerRecord {
  releaseId: string
  shows: number
  dismissed: boolean
}

function domainPart(clientDomain: string): string {
  return encodeURIComponent(clientDomain || 'unknown')
}

export function audienceMarkerKey(clientDomain: string = getClientDomain() || 'unknown'): string {
  return ['whatsNewAudience', domainPart(clientDomain)].join(':')
}

export function bannerRecordKey(clientDomain: string = getClientDomain() || 'unknown'): string {
  return ['whatsNewBanner', domainPart(clientDomain)].join(':')
}

export function buildProductType(): ProductType {
  return normalizeProductType(import.meta.env.PRODUCT_TYPE)
}

/** Macro side. Best-effort and synchronous; never throws into the render path. */
export function markWhatsNewAudience(now: number = Date.now()): void {
  try {
    const key = audienceMarkerKey()
    const last = Date.parse(localStorage.getItem(key) || '')
    if (Number.isFinite(last) && now - last < WHATS_NEW_AUDIENCE_REFRESH_MS) return
    localStorage.setItem(key, new Date(now).toISOString())
  } catch {
    /* storage disabled — the banner simply never qualifies */
  }
}

export function isWhatsNewAudience(now: number = Date.now()): boolean {
  try {
    const last = Date.parse(localStorage.getItem(audienceMarkerKey()) || '')
    return Number.isFinite(last) && now - last < WHATS_NEW_AUDIENCE_TTL_MS
  } catch {
    return false
  }
}

export function parseBannerRecord(raw: string | null): WhatsNewBannerRecord | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<WhatsNewBannerRecord>
    if (typeof p.releaseId !== 'string') return null
    if (typeof p.shows !== 'number' || !Number.isFinite(p.shows)) return null
    if (typeof p.dismissed !== 'boolean') return null
    return { releaseId: p.releaseId, shows: Math.max(0, Math.floor(p.shows)), dismissed: p.dismissed }
  } catch {
    return null
  }
}

/** The record for `releaseId`; a record for any other release reads as fresh. */
export function readBannerRecord(releaseId: string): WhatsNewBannerRecord {
  let stored: WhatsNewBannerRecord | null = null
  try {
    stored = parseBannerRecord(localStorage.getItem(bannerRecordKey()))
  } catch {
    stored = null
  }
  if (stored && stored.releaseId === releaseId) return stored
  return { releaseId, shows: 0, dismissed: false }
}

function writeBannerRecord(record: WhatsNewBannerRecord): void {
  try {
    localStorage.setItem(bannerRecordKey(), JSON.stringify(record))
  } catch {
    /* best-effort: worst case the strip shows again next load */
  }
}

/**
 * E2E isolation switch, same convention as `mockAiRepairEnabled` in
 * apis/aiTitleFeatureFlag.ts. The banner specs (paywall, CSAT) assert what the
 * single page-banner slot does once THEIR banner is gone — that the iframe
 * closes — and a live release would legitimately take the slot instead. Their
 * shared reset (tests/e2e-tests/helpers/pageBanner.ts `clearAllBannerState`)
 * sets this to 'false'.
 */
function isWhatsNewMockedOff(): boolean {
  try {
    return localStorage.getItem('mockWhatsNewEnabled') === 'false'
  } catch {
    return false
  }
}

/**
 * The release to announce on this load, or null. This is the host's gate, so
 * it must stay synchronous and request-free: it runs on every page load.
 */
export function whatsNewCandidate(
  now: number = Date.now(),
  productType: ProductType = buildProductType(),
  releases: readonly WhatsNewRelease[] = WHATS_NEW_RELEASES,
): WhatsNewRelease | null {
  if (isWhatsNewMockedOff()) return null
  const release = currentRelease(productType, now, releases)
  if (!release) return null
  if (!isWhatsNewAudience(now)) return null
  const record = readBannerRecord(release.id)
  if (record.dismissed || record.shows >= WHATS_NEW_MAX_SHOWS) return null
  return release
}

/** Count one impression. Returns which impression this was (1-based). */
export function recordWhatsNewShown(releaseId: string): number {
  const record = readBannerRecord(releaseId)
  const next = { ...record, shows: record.shows + 1 }
  writeBannerRecord(next)
  return next.shows
}

export function recordWhatsNewDismissed(releaseId: string): void {
  writeBannerRecord({ ...readBannerRecord(releaseId), dismissed: true })
}

