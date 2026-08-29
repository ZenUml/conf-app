// Deeplink shape is locked by the autoConvert matcher in manifest.yml. Each
// variant's matcher points at its own backend host — multi-host since the
// #382 Phase 1 migration: lite + diagramly ride conf-lite.zenuml.com, full
// rides conf-full.zenuml.com. confluence.zenuml.com is the retired
// standalone-Worker host, still accepted during the Phase 1->3 transition
// (see docs/superpowers/specs/2026-07-28-deeplink-serving-pages-migration-design.md).
// cloudId = site UUID; contentId = numeric Confluence custom-content id.
export interface EmbedDeeplink {
  cloudId: string;
  contentId: string;
}

const DEEPLINK_RE =
  /^https:\/\/(?:confluence|conf-lite|conf-full)\.zenuml\.com\/d\/([0-9a-fA-F-]{32,36})\/(\d+)\/?(?:[?#].*)?$/;

export function parseEmbedDeeplink(url: string): EmbedDeeplink | undefined {
  const m = DEEPLINK_RE.exec((url || '').trim());
  return m ? { cloudId: m[1].toLowerCase(), contentId: m[2] } : undefined;
}

// Mint side (task 6): which host a variant's minted deeplink points at, keyed
// off the SAME build-time PRODUCT_TYPE (import.meta.env.PRODUCT_TYPE) that
// selects the variant's manifest autoConvert matcher — lite and diagramly
// share the multi-tenant conf-lite Worker, full gets its own. asyncapi has no
// deeplink affordance yet (its viewer doesn't route through GenericViewer),
// so it returns undefined and callers must treat that as "don't render the
// button" rather than falling back to a host.
export function deeplinkHostForProductType(productType: string | undefined): string | undefined {
  switch (productType) {
    case 'lite':
    case 'diagramly':
      return 'conf-lite.zenuml.com';
    case 'full':
      return 'conf-full.zenuml.com';
    default:
      return undefined;
  }
}

// Bare deeplink URL builder — no ticket, no query params (see the module
// comment: the ticketed `/deeplink-ticket` share-preview surface is owned by
// other PRs). Intentionally the exact inverse of DEEPLINK_RE above.
export function buildEmbedDeeplink(host: string, cloudId: string, contentId: string): string {
  return `https://${host}/d/${cloudId}/${contentId}`;
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
export function resolveLocalContentId(
  link: unknown,
  currentCloudId: string | undefined,
): string | undefined {
  if (typeof link !== 'string') return undefined;
  const parsed = parseEmbedDeeplink(link);
  if (!parsed) return undefined;
  if (!currentCloudId || parsed.cloudId !== String(currentCloudId).toLowerCase()) return undefined;
  return parsed.contentId;
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
  const seen = new Set(before || []);
  const fresh = (after || []).filter(id => id && !seen.has(id));
  return fresh.length ? fresh[fresh.length - 1] : undefined;
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
 * real macro claims its own pattern (`/d/sequence/<cloudId>/<contentId>` on the
 * sequence macro, `/d/graph/<cloudId>/<contentId>` on graph, and so on), so a
 * paste produces the ordinary,
 * editable macro pointed at the saved diagram. The URL cannot carry the type
 * implicitly: autoConvert matches on shape alone, with no lookup, so the macro
 * that will handle the paste has to be decidable from the string itself.
 *
 * Segment count keeps the two forms apart: `/d/<cloudId>/<contentId>` is three,
 * `/d/<type>/<cloudId>/<contentId>` is four, and a matcher's `*` covers exactly
 * one segment. Links already pasted
 * or shared as the three-segment form keep resolving as embeds.
 */
export interface TypedDiagramDeeplink extends EmbedDeeplink {
  type: string;
}

// `asyncapi` is here because Lite ships the AsyncAPI macro (ADR-0005 Option A)
// and the byline picker offers it: the post-create panel hands back a
// `/d/<type>/...` link to PLACE the diagram, and a type missing from this list
// makes buildDiagramDeeplink return undefined — a diagram the user just saved
// with no way to get it onto the page. Every picker tile must appear here.
// Adding a type here is only half the contract: the matching `/new/<type>` and
// `/d/<type>/*/*` autoConvert matchers must exist on that type's macro module
// in manifest.yml, or the pasted link converts to nothing.
export const DEEPLINK_TYPES: readonly string[] = ['sequence', 'mermaid', 'plantuml', 'graph', 'openapi', 'asyncapi'];

// Parsing accepts every host the embed form accepts, so a typed link keeps
// resolving after the #382 host migration completes. MINTING stays on
// confluence.zenuml.com because that is the host the typed autoConvert matchers
// in manifest.yml are written against — mint a host the matchers don't list and
// the paste silently fails to convert. Moving both together is follow-up work.
const TYPED_DEEPLINK_HOST = 'confluence.zenuml.com';

const TYPED_DEEPLINK_RE =
  /^https:\/\/(?:confluence|conf-lite|conf-full)\.zenuml\.com\/d\/([a-z]+)\/([0-9a-fA-F-]{32,36})\/(\d+)\/?(?:[?#].*)?$/;

export function buildDiagramDeeplink(
  type: string,
  cloudId: string,
  contentId: string,
): string | undefined {
  const segment = String(type || '').toLowerCase();
  if (!DEEPLINK_TYPES.includes(segment) || !cloudId || !contentId) return undefined;
  return `https://${TYPED_DEEPLINK_HOST}/d/${segment}/${encodeURIComponent(cloudId)}/${encodeURIComponent(contentId)}`;
}

export function parseDiagramDeeplink(link: unknown): TypedDiagramDeeplink | undefined {
  if (typeof link !== 'string' || !link) return undefined;
  const m = TYPED_DEEPLINK_RE.exec(link.trim());
  if (!m) return undefined;
  const type = m[1].toLowerCase();
  if (!DEEPLINK_TYPES.includes(type)) return undefined;
  return { type, cloudId: m[2].toLowerCase(), contentId: m[3] };
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
  const parsed = parseDiagramDeeplink(link);
  if (!parsed) return undefined;
  if (!currentCloudId || parsed.cloudId !== String(currentCloudId).toLowerCase()) return undefined;
  return parsed.contentId;
}
