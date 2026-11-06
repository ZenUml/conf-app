// Scroll to and ring a diagram when the page was opened from a diagram-comment
// link (#1047). The macro reads its own page url (ApWrapper2's currentPageUrl,
// from forgeContext.extension.location, which carries the query string) and
// reveals itself when `zenumlLocal` is its own localId. The reveal itself is
// utils/byline/revealDiagram.ts's revealThisMacro().
import { parseCommentLink } from './commentLink';

export interface LinkRevealTarget {
  localId: string;
  /** Guard key: one reveal per tab per comment link. */
  key: string;
}

/** Is this page url a comment link that points at THIS macro instance? */
export function linkRevealTarget(
  currentPageUrl: string | undefined,
  localId: string | undefined,
): LinkRevealTarget | null {
  if (!currentPageUrl || !localId) return null;
  let url: URL;
  try {
    url = new URL(currentPageUrl);
  } catch {
    return null;
  }
  if (url.searchParams.get('zenumlLocal') !== localId) return null;
  // A link without a diagram id is not ours, even if a param collides.
  const marker = parseCommentLink(currentPageUrl) ?? {
    diagramId: '',
    nonce: url.searchParams.get('zn') ?? undefined,
    diagramVersion: Number(url.searchParams.get('dv')) || undefined,
  };
  const tail = marker.nonce ?? (marker.diagramVersion !== undefined ? String(marker.diagramVersion) : '');
  return { localId, key: `${localId}|${tail}` };
}

const GUARD_PREFIX = 'zenumlCommentReveal:';

/**
 * Let a reveal through once per tab. sessionStorage survives a refresh, so a
 * reload of the same link does not flash again, and it is shared by every macro
 * iframe on the page, hence the key carries the localId. Storage that is
 * unavailable must lose the guard, never the reveal.
 */
export function claimLinkReveal(storage: Storage | undefined, target: LinkRevealTarget): boolean {
  try {
    if (!storage) return true;
    const key = GUARD_PREFIX + target.key;
    if (storage.getItem(key)) return false;
    storage.setItem(key, '1');
    return true;
  } catch {
    return true;
  }
}
