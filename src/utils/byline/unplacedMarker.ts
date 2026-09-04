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
 * Scope: per BROWSER, keyed by page — which is exactly why this is now the
 * FALLBACK, not the primary store. The cross-user path is the content property
 * (unplacedProperty.ts), which Confluence itself gates the banner module on. A
 * marker written with `viaProperty: true` records that the property took the
 * verdict and this copy is inert; only a marker written after a DENIED property
 * write still arms the shared page-banner host, reaching the one browser that
 * created the diagram.
 *
 * What stays here unconditionally is the DISMISSAL, and it belongs here on
 * purpose: one person deciding they do not want to see the notice must not
 * silence it for everyone else on a shared page.
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
  /**
   * The content property (unplacedProperty.ts) took this verdict, so the
   * dedicated `zenuml-unplaced-banner` module — gated server-side on that
   * property — will carry it. The shared page-banner host must then NOT also
   * offer it, or the one page shows the same notice in two banners.
   *
   * False means the property write was denied or failed and this marker is the
   * only record there is: the shared host is the fallback, and the notice
   * reaches this browser alone.
   */
  viaProperty: boolean
}

export interface UnplacedBannerMarker {
  /**
   * The `updatedAt` this user dismissed. Dismissal is scoped to the record
   * version rather than snoozed for a window: a NEW unplaced diagram rewrites
   * `updatedAt` and re-arms the banner, while the diagrams already dismissed
   * stay silent for as long as they remain unplaced. A time window would do
   * both jobs wrong — nagging about the same diagram next week, and staying
   * quiet about a new one today.
   */
  dismissedFor: string | null
  /**
   * WHEN that dismissal happened. `dismissedFor` can only be compared after the
   * record has been read, and on the property path reading it costs a REST
   * call — so a dismissing user would pay one on every load forever. This
   * timestamp is comparable with no record at all, which buys a short quiet
   * window (see DISMISSAL_QUIET_MS) that the re-arm still survives: past the
   * window the record is re-read, and only a CHANGED version shows again.
   */
  dismissedAt: string | null
  /** The `updatedAt` whose entries a verification scan proved are all placed. */
  resolvedFor: string | null
  lastShownAt: string | null
  /** Impressions for `shownFor`. Reset whenever the record version changes. */
  showCount: number
  /** The record version `showCount` counts. */
  shownFor: string | null
}

/**
 * How long a candidate marker is honoured. Past this the banner stops even
 * verifying: the byline has not confirmed the state in a month, and paying one
 * ADF read per page load forever for a diagram the user has evidently made
 * their peace with is not a trade this banner gets to make.
 */
export const UNPLACED_MARKER_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * How long a dismissal silences the banner WITHOUT re-reading the record.
 *
 * Bounds the cost of a dismissal on the property path, where Confluence gates
 * on page state and cannot know this user said no: without it, every load of a
 * dismissed page still boots the iframe and buys a property GET. A day is short
 * enough that a genuinely new unplaced diagram surfaces the next morning.
 *
 * Deliberately NOT applied to `isUnplacedBannerCandidate`: that gate is
 * synchronous localStorage and costs nothing, so the fallback path keeps the
 * stricter promise — a dismissal there is "not now", and a new diagram re-arms
 * it the same minute.
 */
export const DISMISSAL_QUIET_MS = 24 * 60 * 60 * 1000

/**
 * How many times one browser is shown the same record before it stops asking.
 *
 * The banner is page state, so a viewer who neither places the diagram nor
 * dismisses the notice would otherwise meet it on every load for as long as it
 * stands. Placing or dismissing ends it properly; this only stops the nagging.
 */
export const MAX_BANNER_SHOWS = 5

export interface UnplacedIdentity {
  clientDomain: string
  pageId: string
}

/**
 * Coerce whatever a store handed back into entries the UI can render.
 *
 * Shared by both stores on purpose: the marker and the property carry the same
 * shape, and four copies of this filter/map drifted apart the moment one of
 * them learned about a new field.
 *
 * An entry with no id is DROPPED rather than defaulted — the id is what builds
 * the paste link, so a row without one is a button that cannot work.
 */
export function sanitizeUnplacedEntries(raw: unknown): UnplacedDiagramEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is UnplacedDiagramEntry => !!e && typeof (e as any).id === 'string' && !!(e as any).id)
    .map(e => ({
      id: String(e.id),
      title: typeof e.title === 'string' ? e.title : '',
      diagramType: typeof e.diagramType === 'string' ? e.diagramType : '',
    }))
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
    return {
      entries: sanitizeUnplacedEntries(p.entries),
      updatedAt: p.updatedAt,
      viaProperty: p.viaProperty === true,
    }
  } catch {
    return null
  }
}

export function parseUnplacedBannerMarker(raw: string | null): UnplacedBannerMarker {
  const empty: UnplacedBannerMarker = {
    dismissedFor: null,
    dismissedAt: null,
    resolvedFor: null,
    lastShownAt: null,
    showCount: 0,
    shownFor: null,
  }
  if (!raw) return empty
  try {
    const p = JSON.parse(raw) as Partial<UnplacedBannerMarker>
    return {
      dismissedFor: typeof p.dismissedFor === 'string' ? p.dismissedFor : null,
      dismissedAt: typeof p.dismissedAt === 'string' ? p.dismissedAt : null,
      resolvedFor: typeof p.resolvedFor === 'string' ? p.resolvedFor : null,
      lastShownAt: typeof p.lastShownAt === 'string' ? p.lastShownAt : null,
      showCount: typeof p.showCount === 'number' && Number.isFinite(p.showCount) ? Math.floor(p.showCount) : 0,
      shownFor: typeof p.shownFor === 'string' ? p.shownFor : null,
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
  opts: { viaProperty: boolean },
  now: number = Date.now(),
): void {
  const marker: UnplacedMarker = {
    entries: sanitizeUnplacedEntries(entries),
    updatedAt: new Date(now).toISOString(),
    viaProperty: opts.viaProperty,
  }
  writeRaw(unplacedMarkerKey(identity), JSON.stringify(marker))
}

function writeBannerMarker(identity: UnplacedIdentity, next: UnplacedBannerMarker): void {
  writeRaw(unplacedBannerMarkerKey(identity), JSON.stringify(next))
}

export function recordUnplacedBannerShown(
  identity: UnplacedIdentity,
  recordUpdatedAt: string,
  now: number = Date.now(),
): void {
  const current = readUnplacedBannerMarker(identity)
  // A new record version starts its own tally: the cap is "stop nagging about
  // THIS", never "stop telling this browser anything ever again".
  const sameRecord = current.shownFor === recordUpdatedAt
  writeBannerMarker(identity, {
    ...current,
    lastShownAt: new Date(now).toISOString(),
    showCount: sameRecord ? current.showCount + 1 : 1,
    shownFor: recordUpdatedAt,
  })
}

/** Has this browser already been told about this record enough times? */
export function hasExhaustedShows(identity: UnplacedIdentity, recordUpdatedAt: string): boolean {
  const banner = readUnplacedBannerMarker(identity)
  return banner.shownFor === recordUpdatedAt && banner.showCount >= MAX_BANNER_SHOWS
}

export function recordUnplacedBannerDismissed(
  identity: UnplacedIdentity,
  recordUpdatedAt: string,
  now: number = Date.now(),
): void {
  const current = readUnplacedBannerMarker(identity)
  writeBannerMarker(identity, {
    ...current,
    dismissedFor: recordUpdatedAt,
    dismissedAt: new Date(now).toISOString(),
  })
}

/**
 * Was this page dismissed recently enough to skip reading the record at all?
 *
 * Synchronous and record-free by design — it is the only dismissal check the
 * property path can make BEFORE paying for a REST call.
 */
export function isDismissalQuiet(identity: UnplacedIdentity, now: number = Date.now()): boolean {
  const dismissedAt = readUnplacedBannerMarker(identity).dismissedAt
  if (!dismissedAt) return false
  const at = Date.parse(dismissedAt)
  return Number.isFinite(at) && now - at < DISMISSAL_QUIET_MS
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
  // The property took it, so the gated module shows it — to everyone, not just
  // this browser. Offering it here too would stack two banners saying the same
  // thing on the one page.
  if (marker.viaProperty) return false
  const updatedAtMs = Date.parse(marker.updatedAt)
  if (!Number.isFinite(updatedAtMs)) return false
  if (now - updatedAtMs > UNPLACED_MARKER_TTL_MS) return false
  // NOT the quiet window: that exists to save a REST call on the property path,
  // and this gate is free. Here a dismissal really is "not now" — a new diagram
  // rewrites `updatedAt` and shows again immediately.
  if (hasExhaustedShows(identity, marker.updatedAt)) return false
  const banner = readUnplacedBannerMarker(identity)
  if (banner.dismissedFor === marker.updatedAt) return false
  if (banner.resolvedFor === marker.updatedAt) return false
  return true
}
