// The write side of the 3LO credential: same gateway, same refresh, any verb.
//
// confluenceReader.ts deliberately exposes only `ConfluenceGet`, because that
// is the interface Phase 1's resolver was written against and narrowing it was
// the point. Writes need POST and PUT, so they get their own surface here
// rather than widening that one — a module that can only read stays a module
// that can only read.
//
// Everything still runs as the user who consented. A 403 from here is
// Confluence saying that person may not edit that page, which is a correct
// outcome to report rather than an error to work around.

import { apiBaseUrlFor, type AtlassianAppConfig, type FetchLike } from './atlassianClient';
import { getAccessToken, type GrantStore } from './tokenStore';

export interface WriterContext {
  store: GrantStore;
  secret: string;
  app: AtlassianAppConfig;
  fetchImpl: FetchLike;
  userId: string;
  cloudId: string;
  nowMs?: () => number;
}

export interface ConfluenceResponse {
  status: number;
  body: unknown;
  ok: boolean;
}

export type ConfluenceRequest = (
  path: string,
  init?: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown },
) => Promise<ConfluenceResponse>;

/** 401/503 for "no credential" / "could not refresh", matching confluenceReader.ts. */
const NO_CREDENTIAL_STATUS = 401;
const REFRESH_FAILED_STATUS = 503;

export function confluenceRequestFor(ctx: WriterContext): ConfluenceRequest {
  const base = apiBaseUrlFor(ctx.cloudId);
  const now = ctx.nowMs ?? Date.now;

  return async (path, init = {}) => {
    const token = await getAccessToken(ctx.store, ctx.secret, ctx.app, ctx.fetchImpl, ctx.userId, now());
    if (!token.ok) {
      return {
        ok: false,
        status: token.reason === 'refresh_failed' ? REFRESH_FAILED_STATUS : NO_CREDENTIAL_STATUS,
        body: { error: token.reason, detail: token.detail },
      };
    }

    const method = init.method ?? 'GET';
    let res: Response;
    try {
      res = await ctx.fetchImpl(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch (e) {
      return {
        ok: false,
        status: REFRESH_FAILED_STATUS,
        body: { error: 'network', detail: e instanceof Error ? e.message : String(e) },
      };
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Some Confluence errors are not JSON; the status still carries the fact.
    }
    return { ok: res.ok, status: res.status, body };
  };
}
