import forgeGlobal from '@/model/globals/forgeGlobal'
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'

/**
 * Cross-iframe marker for the unplaced-diagram page banner.
 *
 * A diagram saved from the byline and never pasted exists as the page's custom
 * content, counts against the Lite 100-macro limit, and renders nowhere. The
 * byline says so ("· not on this page") — but Confluence boots the byline
 * iframe only when the item is CLICKED, so the one surface that knows is the
 * one nobody opens. The page banner mounts on EVERY page load, and that is
 * where the fact belongs.
 *
 * The banner cannot discover this by itself at an acceptable price: finding it
 * takes one custom-content listing PER diagram type plus a full-page ADF read,
 * on every page load of every page in the site. So the byline — which pays
 * those reads anyway, for its own list — leaves the answer behind in
 * localStorage, and the banner reads it synchronously. Same shape as the
 * paywall warning banner's targeting marker (utils/paywall/warningBanner.ts):
 * the two iframes share an origin (both are this app's Forge CDN host) and can
 * never call each other directly.
 *
 * Two keys, ONE WRITER EACH — a shared key would let the two iframes clobber
 * each other's read-modify-write:
 *
 *   - CANDIDATE marker (`bylineUnplaced:<domain>:<pageId>`) — written ONLY by
 *     the byline (BylineDiagrams.vue), after its own ADF scan resolves or after
 *     it creates a diagram. Names the diagrams it observed unplaced.
 *   - BANNER marker (`bylineUnplacedBanner:<domain>:<pageId>`) — written ONLY by
 *     the page-banner iframe. Records dismissal, impressions, and the
 *     resolution the banner's own verification scan proved.
 *
 * What the marker is NOT: proof. It is a CANDIDATE signal, and the banner
 * always re-verifies against the live page ADF before saying anything (see
 * UnplacedDiagramsBanner.vue). The user may have pasted the link the moment
 * after the byline wrote the marker, and a banner that told them otherwise
 * would be worse than no banner.
 *
 * Scope: per BROWSER, keyed by page. Only the person who created the diagram
 * gets the banner, because only their browser holds the marker. That is a
 * deliberate limit, not an oversight — the creator is the one who can place it,
 * and the alternative (a site-wide scan on every page load) is exactly the
 * hot-path cost the page-banner design forbids. `docs/features/page-banner.md`:
 * "Decide visibility from cached/context-only data so the iframe doesn't depend
 * on a cold-start network call."
 */

/** One diagram the byline observed as saved-here-but-not-on-the-page. */
export interface UnplacedDiagramEntry {
  /** customContentId. */
  id: string
  title: string
  /** DiagramType value as stored on the custom content, e.g. 'sequence'. */
  diagramType: string
}

export interface UnplacedMarker {
  entries: UnplacedDiagramEntry[]
  /** ISO timestamp of the byline scan that produced `entries`. */
  updatedAt: string
}

export interface UnplacedBannerMarker {
  /**
   * The `updatedAt` this user dismissed. Dismissal is scoped to the marker
   * version rather than snoozed for a window: a NEW unplaced diagram rewrites
   * `updatedAt` and re-arms the banner, while the diagrams already dismissed
   * stay silent for as long as they remain unplaced. A time window would do
   * both jobs wrong — nagging about the same diagram next week, and staying
   * quiet about a new one today.
   */
  dismissedFor: string | null
  /** The `updatedAt` whose entries a verification scan proved are all placed. */
  resolvedFor: string | null
  lastShownAt: string | null
  showCount: number
}

/**
 * How long a candidate marker is honoured. Past this the banner stops even
 * verifying: the byline has not confirmed the state in a month, and paying one
 * ADF read per page load forever for a diagram the user has evidently made
 * their peace with is not a trade this banner gets to make.
 */
export const UNPLACED_MARKER_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface UnplacedIdentity {
  clientDomain: string
  pageId: string
}

/** encodeURIComponent + 'unknown' fallback, so the byline write and the banner
 *  read derive byte-identical keys (mirrors warningBanner.ts). */
function normalizeKeyPart(value: string): string {
  return encodeURIComponent(value || 'unknown')
}

/**
 * Identity for the page this iframe is mounted on, or `null` when the page is
 * unknown.
 *
 * `null` is load-bearing: a marker keyed on a guessed page id would be read by
 * the banner on a DIFFERENT page and claim diagrams that are not there. Both
 * sides therefore refuse to act rather than fall back. `extension.content.id`
 * is the same source AtlasPage.getPageId() reads, and is what every macro,
 * byline and banner iframe of this app is given.
 */
export function deriveUnplacedIdentity(): UnplacedIdentity | null {
  const pageId = forgeGlobal.forgeContext?.extension?.content?.id
  if (!pageId) return null
  return { clientDomain: getClientDomain() || 'unknown', pageId: String(pageId) }
}

export function unplacedMarkerKey(identity: UnplacedIdentity): string {
  return ['bylineUnplaced', normalizeKeyPart(identity.clientDomain), normalizeKeyPart(identity.pageId)].join(':')
}

export function unplacedBannerMarkerKey(identity: UnplacedIdentity): string {
  return ['bylineUnplacedBanner', normalizeKeyPart(identity.clientDomain), normalizeKeyPart(identity.pageId)].join(':')
}

/** Every localStorage access here is best-effort: a restrictive iframe or a
 *  full quota must degrade to "no banner", never to a thrown byline. */
function readRaw(key: string): string | null {
  try {
    return window.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage?.setItem(key, value)
  } catch (e) {
    console.debug('[byline] unplaced marker write failed', e)
  }
}

export function parseUnplacedMarker(raw: string | null): UnplacedMarker | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<UnplacedMarker>
    if (typeof p.updatedAt !== 'string' || !p.updatedAt) return null
    if (!Array.isArray(p.entries)) return null
    const entries = p.entries
      .filter((e): e is UnplacedDiagramEntry => !!e && typeof (e as any).id === 'string' && !!(e as any).id)
      .map(e => ({
        id: String(e.id),
        title: typeof e.title === 'string' ? e.title : '',
        diagramType: typeof e.diagramType === 'string' ? e.diagramType : '',
      }))
    return { entries, updatedAt: p.updatedAt }
  } catch {
    return null
  }
}

export function parseUnplacedBannerMarker(raw: string | null): UnplacedBannerMarker {
  const empty: UnplacedBannerMarker = {
    dismissedFor: null,
    resolvedFor: null,
    lastShownAt: null,
    showCount: 0,
  }
  if (!raw) return empty
  try {
    const p = JSON.parse(raw) as Partial<UnplacedBannerMarker>
    return {
      dismissedFor: typeof p.dismissedFor === 'string' ? p.dismissedFor : null,
      resolvedFor: typeof p.resolvedFor === 'string' ? p.resolvedFor : null,
      lastShownAt: typeof p.lastShownAt === 'string' ? p.lastShownAt : null,
      showCount: typeof p.showCount === 'number' && Number.isFinite(p.showCount) ? Math.floor(p.showCount) : 0,
    }
  } catch {
    return empty
  }
}

export function readUnplacedMarker(identity: UnplacedIdentity): UnplacedMarker | null {
  return parseUnplacedMarker(readRaw(unplacedMarkerKey(identity)))
}

export function readUnplacedBannerMarker(identity: UnplacedIdentity): UnplacedBannerMarker {
  return parseUnplacedBannerMarker(readRaw(unplacedBannerMarkerKey(identity)))
}

/**
 * Record what the byline just observed.
 *
 * An EMPTY list is written, not skipped: "the byline looked and everything is
 * placed" is the fact that retires a banner the user has already fixed, and
 * dropping it would leave the last non-empty marker standing.
 *
 * `updatedAt` moves on every write, including one that repeats the same
 * entries — which deliberately re-arms a dismissed banner. The user dismissed
 * a statement about diagrams; re-opening the byline and leaving them unplaced
 * is them looking at the same statement again.
 */
export function writeUnplacedMarker(
  identity: UnplacedIdentity,
  entries: UnplacedDiagramEntry[],
  now: number = Date.now(),
): void {
  const marker: UnplacedMarker = {
    entries: entries.map(e => ({ id: String(e.id), title: e.title || '', diagramType: e.diagramType || '' })),
    updatedAt: new Date(now).toISOString(),
  }
  writeRaw(unplacedMarkerKey(identity), JSON.stringify(marker))
}

function writeBannerMarker(identity: UnplacedIdentity, next: UnplacedBannerMarker): void {
  writeRaw(unplacedBannerMarkerKey(identity), JSON.stringify(next))
}

export function recordUnplacedBannerShown(
  identity: UnplacedIdentity,
  now: number = Date.now(),
): void {
  const current = readUnplacedBannerMarker(identity)
  writeBannerMarker(identity, {
    ...current,
    lastShownAt: new Date(now).toISOString(),
    showCount: current.showCount + 1,
  })
}

export function recordUnplacedBannerDismissed(identity: UnplacedIdentity, markerUpdatedAt: string): void {
  const current = readUnplacedBannerMarker(identity)
  writeBannerMarker(identity, { ...current, dismissedFor: markerUpdatedAt })
}

/**
 * The banner's verification scan found every named diagram on the page. Stops
 * this marker version from costing another ADF read on every subsequent load —
 * the banner-side counterpart to an empty byline write, for the far more common
 * case where the user pastes the link and never opens the byline again.
 */
export function recordUnplacedBannerResolved(identity: UnplacedIdentity, markerUpdatedAt: string): void {
  const current = readUnplacedBannerMarker(identity)
  writeBannerMarker(identity, { ...current, resolvedFor: markerUpdatedAt })
}

/**
 * Is this page a CANDIDATE for the unplaced banner?
 *
 * Synchronous and localStorage-only, because it runs inside decidePageBanner()
 * on every Confluence page load in the site. Everything expensive — the ADF
 * read that turns a candidate into a claim — happens after this returns true,
 * which on the overwhelming majority of loads it does not (no marker at all).
 */
export function isUnplacedBannerCandidate(
  identity: UnplacedIdentity | null,
  now: number = Date.now(),
): boolean {
  if (!identity) return false
  const marker = readUnplacedMarker(identity)
  if (!marker || marker.entries.length === 0) return false
  const updatedAtMs = Date.parse(marker.updatedAt)
  if (!Number.isFinite(updatedAtMs)) return false
  if (now - updatedAtMs > UNPLACED_MARKER_TTL_MS) return false
  const banner = readUnplacedBannerMarker(identity)
  if (banner.dismissedFor === marker.updatedAt) return false
  if (banner.resolvedFor === marker.updatedAt) return false
  return true
}
