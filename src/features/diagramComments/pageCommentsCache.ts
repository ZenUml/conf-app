// One read of a page's footer comments, shared by every diagram on the page (#1047).
//
// Ten macros on a page would otherwise make ten identical reads on load, and
// 429s from Confluence are a known problem here. A failed read is forgotten so
// the next ask retries; a post invalidates the page so the next read is fresh.
import { fetchPageRootComments, type CommentRequest } from './commentsClient';
import { rootsForDiagram, type RawComment } from './commentThreads';

// Per iframe: macros on one page are separate iframes, so this dedupes within one
// iframe (the fullscreen panel and its own count); the lazy-on-click rule is
// what keeps a page of macros from each reading the page.
const cache = new Map<string, Promise<RawComment[]>>();

export function getPageRootComments(request: CommentRequest, pageId: string): Promise<RawComment[]> {
  let pending = cache.get(pageId);
  if (!pending) {
    pending = fetchPageRootComments(request, pageId);
    cache.set(pageId, pending);
    pending.catch(() => {
      if (cache.get(pageId) === pending) cache.delete(pageId);
    });
  }
  return pending;
}

export function invalidatePageComments(pageId: string): void {
  cache.delete(pageId);
}

export function resetPageCommentsCache(): void {
  cache.clear();
}

/** Top-level comment threads that point at this diagram. */
export async function diagramCommentCount(request: CommentRequest, pageId: string, diagramId: string): Promise<number> {
  return rootsForDiagram(await getPageRootComments(request, pageId), diagramId).length;
}
