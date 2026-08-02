/**
 * Diagram deeplinks — `https://confluence.zenuml.com/d/<cloudId>/<contentId>`.
 *
 * Pasting one into the editor auto-converts it into the **embed** macro, which
 * renders the referenced diagram. This is the "create it, then place it" half of
 * the byline flow: the modal opens a real editor, the user saves a diagram, and
 * the link that comes back is how that diagram gets onto the page.
 *
 * The scheme and its behaviour were proven end to end on 2026-07-16 — see
 * docs/superpowers/plans/2026-07-16-embed-autoconvert-deeplink-spike.md.
 * Conversion works in the current editor and in Live Docs, and the URL never has
 * to resolve, because matching is editor-local (the host still 404s).
 *
 * `cloudId` is in the URL so a link pasted into a DIFFERENT site can be
 * recognised as foreign and refused rather than silently fetching, or worse,
 * resolving to an unrelated content id that happens to collide.
 */

export interface EmbedDeeplink {
  cloudId: string
  contentId: string
}

export const EMBED_DEEPLINK_BASE = 'https://confluence.zenuml.com/d'

export function buildEmbedDeeplink(cloudId: string, contentId: string): string | undefined {
  if (!cloudId || !contentId) return undefined
  return `${EMBED_DEEPLINK_BASE}/${encodeURIComponent(cloudId)}/${encodeURIComponent(contentId)}`
}

/**
 * Parse a pasted link. Returns undefined for anything that is not exactly our
 * two-segment https form — the manifest matcher is `/d/*​/*`, so a URL of any
 * other shape never converts and must never be interpreted here either.
 */
export function parseEmbedDeeplink(link: unknown): EmbedDeeplink | undefined {
  if (typeof link !== 'string' || !link) return undefined
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:') return undefined
  if (url.host !== 'confluence.zenuml.com') return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 3 || parts[0] !== 'd') return undefined
  const cloudId = decodeURIComponent(parts[1])
  const contentId = decodeURIComponent(parts[2])
  if (!cloudId || !contentId) return undefined
  return { cloudId, contentId }
}

/**
 * The content id a pasted link points at, but only when the link belongs to
 * THIS site.
 *
 * The cloudId guard is the whole point: custom-content ids are per-site
 * integers, so a link copied from another tenant would otherwise resolve to
 * whatever local content shares that number — showing a stranger's diagram
 * instead of failing. Returning undefined lets the viewer fall through to its
 * existing "couldn't be loaded" message.
 */
export function resolveLocalContentId(link: unknown, currentCloudId: string | undefined): string | undefined {
  const parsed = parseEmbedDeeplink(link)
  if (!parsed) return undefined
  if (!currentCloudId || parsed.cloudId !== currentCloudId) return undefined
  return parsed.contentId
}

/**
 * The id created while the editor modal was open.
 *
 * A byline-opened editor cannot write its new customContentId back into a macro
 * (there is no macro), and `view.submit` is not valid on that surface, so the
 * id never reaches the caller through Forge. Diffing the page's diagram list
 * across the modal is what recovers it. Newest-first ordering is not guaranteed
 * by the API, so identity is by id rather than position; if several appeared
 * (a double save), the last new one wins — that is the content the user ended
 * up looking at.
 */
export function newlyCreatedId(before: Array<string>, after: Array<string>): string | undefined {
  const seen = new Set(before || [])
  const fresh = (after || []).filter(id => id && !seen.has(id))
  return fresh.length ? fresh[fresh.length - 1] : undefined
}


/**
 * Typed diagram deeplink — `.../d/<type>/<cloudId>/<contentId>`.
 *
 * The three-segment form above converts into the EMBED macro, which renders a
 * diagram but cannot edit it: its own editor is a document picker, and the
 * viewer offers nothing but "edit the macro to pick a different diagram". A
 * diagram placed that way is read-only forever, which is not what "add a
 * diagram to my page" should mean.
 *
 * Because we generate the link, the type can go in the path — and then each
 * real macro claims its own pattern (`/d/sequence/*​/*` on the sequence macro,
 * `/d/graph/*​/*` on graph, and so on), so a paste produces the ordinary,
 * editable macro pointed at the saved diagram. The URL cannot carry the type
 * implicitly: autoConvert matches on shape alone, with no lookup, so the macro
 * that will handle the paste has to be decidable from the string itself.
 *
 * Segment count keeps the two forms apart: `/d/*​/*` is three, `/d/<type>/*​/*`
 * is four, and a matcher's `*` covers exactly one segment. Links already pasted
 * or shared as the three-segment form keep resolving as embeds.
 */
export interface TypedDiagramDeeplink extends EmbedDeeplink {
  type: string
}

const DEEPLINK_TYPES = ['sequence', 'mermaid', 'plantuml', 'graph', 'openapi']

export function buildDiagramDeeplink(
  type: string,
  cloudId: string,
  contentId: string,
): string | undefined {
  const segment = String(type || '').toLowerCase()
  if (!DEEPLINK_TYPES.includes(segment) || !cloudId || !contentId) return undefined
  return `${EMBED_DEEPLINK_BASE}/${segment}/${encodeURIComponent(cloudId)}/${encodeURIComponent(contentId)}`
}

export function parseDiagramDeeplink(link: unknown): TypedDiagramDeeplink | undefined {
  if (typeof link !== 'string' || !link) return undefined
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:') return undefined
  if (url.host !== 'confluence.zenuml.com') return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 4 || parts[0] !== 'd') return undefined
  const type = parts[1].toLowerCase()
  if (!DEEPLINK_TYPES.includes(type)) return undefined
  const cloudId = decodeURIComponent(parts[2])
  const contentId = decodeURIComponent(parts[3])
  if (!cloudId || !contentId) return undefined
  return { type, cloudId, contentId }
}

/**
 * The content id a pasted TYPED link points at, guarded on cloudId for the same
 * reason as the embed form: content ids are per-site integers, so a foreign
 * link would otherwise open an unrelated local diagram for editing.
 */
export function resolveLocalTypedContentId(
  link: unknown,
  currentCloudId: string | undefined,
): string | undefined {
  const parsed = parseDiagramDeeplink(link)
  if (!parsed) return undefined
  if (!currentCloudId || parsed.cloudId !== currentCloudId) return undefined
  return parsed.contentId
}
