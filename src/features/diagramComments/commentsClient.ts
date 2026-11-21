// Read and write Confluence page footer comments as the current user (#1047).
//
// Takes the request function as an argument so it is tested without the Forge
// bridge; the caller passes `requestConfluenceJson` from utils/byline.
import type { DiagramCommentFailureReason } from '@/utils/analytics/catalog';
import type { RawComment } from './commentThreads';

export interface CommentResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type CommentRequest = (url: string, method: string, body?: unknown) => Promise<CommentResponse>;

export function failureReasonFor(status: number | undefined): DiagramCommentFailureReason {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'permission_denied';
  if (status === 429) return 'rate_limited';
  if (status !== undefined && (status === 404 || status >= 500)) return 'unavailable';
  return 'unknown';
}

export class DiagramCommentError extends Error {
  constructor(
    public readonly reason: DiagramCommentFailureReason,
    public readonly status?: number,
    /** A post whose outcome is unknown: the caller must read back before sending again. */
    public readonly uncertain = false,
  ) {
    super(`diagram comment request failed: ${reason}${status ? ` (${status})` : ''}`);
    this.name = 'DiagramCommentError';
  }
}

async function send(request: CommentRequest, url: string, method: string, body?: unknown, uncertainOnNetwork = false) {
  let res: CommentResponse;
  try {
    res = await request(url, method, body);
  } catch {
    throw new DiagramCommentError('network', undefined, uncertainOnNetwork);
  }
  if (!res.ok) throw new DiagramCommentError(failureReasonFor(res.status), res.status);
  return res;
}

const nextUrl = (links: unknown): string | undefined => {
  const next = (links as { next?: unknown } | undefined)?.next;
  if (typeof next !== 'string' || !next) return undefined;
  return next.startsWith('/wiki/') ? next : next.startsWith('/') ? `/wiki${next}` : undefined;
};

async function readAll(request: CommentRequest, firstUrl: string, maxPages: number): Promise<RawComment[]> {
  const out: RawComment[] = [];
  let url: string | undefined = firstUrl;
  for (let page = 0; url && page < maxPages; page++) {
    const res = await send(request, url, 'GET');
    const data = (await res.json()) as { results?: RawComment[]; _links?: unknown };
    out.push(...(data.results ?? []));
    url = nextUrl(data._links);
  }
  return out;
}

/** The page's top-level footer comments. Replies are not in this list. */
export function fetchPageRootComments(request: CommentRequest, pageId: string, opts: { maxPages?: number } = {}) {
  return readAll(
    request,
    `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/footer-comments?body-format=atlas_doc_format&limit=100`,
    opts.maxPages ?? 10,
  );
}

export function fetchReplies(request: CommentRequest, commentId: string, opts: { maxPages?: number } = {}) {
  return readAll(
    request,
    `/wiki/api/v2/footer-comments/${encodeURIComponent(commentId)}/children?body-format=atlas_doc_format&limit=100`,
    opts.maxPages ?? 5,
  );
}

/** A root comment (pageId) or a reply (parentCommentId). Never retried here. */
export async function postFooterComment(
  request: CommentRequest,
  input: { pageId?: string; parentCommentId?: string; adf: unknown },
): Promise<{ id: string }> {
  const body = {
    ...(input.parentCommentId ? { parentCommentId: input.parentCommentId } : { pageId: input.pageId }),
    body: { representation: 'atlas_doc_format', value: JSON.stringify(input.adf) },
  };
  const res = await send(request, '/wiki/api/v2/footer-comments', 'POST', body, true);
  const data = (await res.json()) as { id?: unknown };
  return { id: String(data.id) };
}

export interface UserName {
  displayName: string;
  avatarPath?: string;
}

/** Names and avatars are decoration: any failure returns what we have (nothing). */
export async function fetchUserNames(request: CommentRequest, accountIds: string[]): Promise<Record<string, UserName>> {
  const unique = [...new Set(accountIds.filter(Boolean))];
  if (!unique.length) return {};
  try {
    const res = await send(request, '/wiki/api/v2/users-bulk', 'POST', { accountIds: unique });
    const data = (await res.json()) as {
      results?: Array<{ accountId?: string; displayName?: string; profilePicture?: { path?: string } }>;
    };
    const out: Record<string, UserName> = {};
    for (const u of data.results ?? []) {
      if (u.accountId && u.displayName) {
        out[u.accountId] = { displayName: u.displayName, ...(u.profilePicture?.path ? { avatarPath: u.profilePicture.path } : {}) };
      }
    }
    return out;
  } catch {
    return {};
  }
}
