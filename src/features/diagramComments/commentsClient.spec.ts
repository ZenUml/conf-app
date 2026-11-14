import { describe, expect, it, vi } from 'vitest';
import {
  DiagramCommentError,
  failureReasonFor,
  fetchPageRootComments,
  fetchReplies,
  fetchUserNames,
  postFooterComment,
  type CommentRequest,
} from './commentsClient';

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('failureReasonFor', () => {
  it.each([
    [401, 'unauthenticated'],
    [403, 'permission_denied'],
    [429, 'rate_limited'],
    [404, 'unavailable'],
    [502, 'unavailable'],
    [418, 'unknown'],
  ])('%s -> %s', (status, reason) => {
    expect(failureReasonFor(status)).toBe(reason);
  });
});

describe('fetchPageRootComments', () => {
  it('reads every page of top-level comments, following the cursor link', async () => {
    const request = vi
      .fn<CommentRequest>()
      .mockResolvedValueOnce(res(200, { results: [{ id: '1' }, { id: '2' }], _links: { next: '/wiki/api/v2/pages/7/footer-comments?cursor=abc' } }))
      .mockResolvedValueOnce(res(200, { results: [{ id: '3' }], _links: {} }));
    const out = await fetchPageRootComments(request, '7');
    expect(out.map(c => c.id)).toEqual(['1', '2', '3']);
    expect(request.mock.calls[0][0]).toBe('/wiki/api/v2/pages/7/footer-comments?body-format=atlas_doc_format&limit=100');
    expect(request.mock.calls[1][0]).toBe('/wiki/api/v2/pages/7/footer-comments?cursor=abc');
  });

  it('adds the /wiki prefix when the next link is relative to the API root', async () => {
    const request = vi
      .fn<CommentRequest>()
      .mockResolvedValueOnce(res(200, { results: [], _links: { next: '/api/v2/pages/7/footer-comments?cursor=z' } }))
      .mockResolvedValueOnce(res(200, { results: [] }));
    await fetchPageRootComments(request, '7');
    expect(request.mock.calls[1][0]).toBe('/wiki/api/v2/pages/7/footer-comments?cursor=z');
  });

  it('stops at the page cap instead of reading forever', async () => {
    const request = vi.fn<CommentRequest>().mockImplementation(async () => res(200, { results: [{ id: 'x' }], _links: { next: '/wiki/api/v2/n' } }));
    const out = await fetchPageRootComments(request, '7', { maxPages: 3 });
    expect(request).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(3);
  });

  it('turns an HTTP failure into a typed error', async () => {
    const request = vi.fn<CommentRequest>().mockResolvedValue(res(429, {}));
    await expect(fetchPageRootComments(request, '7')).rejects.toMatchObject({ reason: 'rate_limited', status: 429 });
  });

  it('turns a thrown network error into reason "network"', async () => {
    const request = vi.fn<CommentRequest>().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await fetchPageRootComments(request, '7').catch(e => e);
    expect(err).toBeInstanceOf(DiagramCommentError);
    expect(err.reason).toBe('network');
  });
});

describe('fetchReplies', () => {
  it('reads the children of one comment', async () => {
    const request = vi.fn<CommentRequest>().mockResolvedValue(res(200, { results: [{ id: 'r1' }] }));
    expect((await fetchReplies(request, '55')).map(c => c.id)).toEqual(['r1']);
    expect(request.mock.calls[0][0]).toBe('/wiki/api/v2/footer-comments/55/children?body-format=atlas_doc_format&limit=100');
  });
});

describe('postFooterComment', () => {
  const adf = { version: 1, type: 'doc', content: [] };

  it('posts a root comment on the page as an ADF string and returns the new id', async () => {
    const request = vi.fn<CommentRequest>().mockResolvedValue(res(201, { id: '900' }));
    await expect(postFooterComment(request, { pageId: '7', adf })).resolves.toEqual({ id: '900' });
    const [url, method, body] = request.mock.calls[0];
    expect(url).toBe('/wiki/api/v2/footer-comments');
    expect(method).toBe('POST');
    expect(body).toEqual({ pageId: '7', body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) } });
  });

  it('posts a reply with the parent comment id and no page id', async () => {
    const request = vi.fn<CommentRequest>().mockResolvedValue(res(201, { id: '901' }));
    await postFooterComment(request, { parentCommentId: '55', adf });
    expect(request.mock.calls[0][2]).toEqual({ parentCommentId: '55', body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) } });
  });

  it('marks a network failure as uncertain so the caller reads back before trying again', async () => {
    const request = vi.fn<CommentRequest>().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await postFooterComment(request, { pageId: '7', adf }).catch(e => e);
    expect(err.reason).toBe('network');
    expect(err.uncertain).toBe(true);
  });

  it('does not mark a clear HTTP refusal as uncertain', async () => {
    const request = vi.fn<CommentRequest>().mockResolvedValue(res(403, {}));
    const err = await postFooterComment(request, { pageId: '7', adf }).catch(e => e);
    expect(err.reason).toBe('permission_denied');
    expect(err.uncertain).toBe(false);
  });
});

describe('fetchUserNames', () => {
  it('maps account ids to display names, and degrades to an empty map on failure', async () => {
    const ok = vi.fn<CommentRequest>().mockResolvedValue(
      res(200, { results: [{ accountId: 'a1', displayName: 'Mia Lin', profilePicture: { path: '/wiki/aa-avatar/a1' } }] }),
    );
    expect(await fetchUserNames(ok, ['a1', 'a1'])).toEqual({ a1: { displayName: 'Mia Lin', avatarPath: '/wiki/aa-avatar/a1' } });
    expect(ok.mock.calls[0][2]).toEqual({ accountIds: ['a1'] });

    const bad = vi.fn<CommentRequest>().mockRejectedValue(new Error('x'));
    expect(await fetchUserNames(bad, ['a1'])).toEqual({});
    expect(await fetchUserNames(ok, [])).toEqual({});
  });
});
