import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diagramCommentCount, getPageRootComments, invalidatePageComments, resetPageCommentsCache } from './pageCommentsCache';
import type { CommentRequest } from './commentsClient';

const PAGE = 'https://example.atlassian.net/wiki/spaces/SD/pages/123/Order+flow';
const root = (id: string, diagram: string) => ({
  id,
  body: {
    atlas_doc_format: {
      value: JSON.stringify({
        version: 1,
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: `${PAGE}?zenumlDiagram=${diagram}` } }] }] }],
      }),
    },
  },
  version: { authorId: 'u', createdAt: '2026-11-04T10:00:00Z' },
});
const ok = (results: unknown[]) => ({ ok: true, status: 200, json: async () => ({ results }) });

describe('page comments cache', () => {
  beforeEach(() => resetPageCommentsCache());

  it('reads a page once however many diagrams ask', async () => {
    const request = vi.fn<CommentRequest>().mockResolvedValue(ok([root('1', '900'), root('2', '900'), root('3', '901')]));
    const [a, b] = await Promise.all([diagramCommentCount(request, '7', '900'), diagramCommentCount(request, '7', '901')]);
    expect(request).toHaveBeenCalledTimes(1);
    expect([a, b]).toEqual([2, 1]);
  });

  it('forgets a failed read so the next ask tries again', async () => {
    const request = vi
      .fn<CommentRequest>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok([root('1', '900')]));
    await expect(getPageRootComments(request, '7')).rejects.toMatchObject({ reason: 'network' });
    await expect(getPageRootComments(request, '7')).resolves.toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('reads again after the page is invalidated, for example after a post', async () => {
    const request = vi.fn<CommentRequest>().mockResolvedValue(ok([]));
    await getPageRootComments(request, '7');
    invalidatePageComments('7');
    await getPageRootComments(request, '7');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
