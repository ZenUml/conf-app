// The headless tool surface: what an agent can do with the page closed.
//
// READ ONLY, deliberately. Design §11 Phase 4 puts `update_diagram` and
// `create_diagram` behind the server-side gate of §9.1, and that gate does not
// exist yet. Shipping reads first means the credential, the identity resolver
// and the transport are all exercised by real use before anything can write to
// a customer's page — and there is prior art for why that ordering matters
// (the lite→full conversion incident in §6).
//
// Every tool here goes through `confluenceReaderFor`, so each call refreshes
// the Atlassian grant if it has to and acts strictly as the user who
// consented. Nothing takes a cloudId on trust: a site must be one that
// `accessible-resources` returned for this user's grant, or the call is
// refused before any Confluence request goes out.

import { listAccessibleSites, type AtlassianAppConfig, type FetchLike } from './atlassianClient';
import { confluenceReaderFor } from './confluenceReader';
import { getAccessToken, type GrantStore } from './tokenStore';
import {
  customContentTypesFor,
  resolveMacroIdentity,
  VARIANTS,
  type ConfluenceGet,
} from '../macroIdentity';

export interface HeadlessContext {
  store: GrantStore;
  secret: string;
  app: AtlassianAppConfig;
  fetchImpl: FetchLike;
  /** The Atlassian account id the MCP token is bound to. Never from the request. */
  userId: string;
  nowMs?: () => number;
}

export interface HeadlessToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const HEADLESS_TOOLS: readonly HeadlessToolDescriptor[] = [
  {
    name: 'list_sites',
    description:
      'List the Confluence sites your ZenUML authorization can reach, with the cloudId each other tool needs. Start here. Read-only.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_diagrams',
    description:
      'List ZenUML diagrams on a site, most-recently-modified first. Scope to one page with pageId, or omit it for the whole site. Open one with read_diagram { cloudId, contentId }. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        cloudId: { type: 'string', description: 'From list_sites.' },
        pageId: { type: 'string', description: 'Optional. Only diagrams on this page.' },
        limit: { type: 'number', description: 'Optional. Max rows (default 25, capped at 100).' },
      },
      required: ['cloudId'],
    },
  },
  {
    name: 'read_diagram',
    description:
      'Read one diagram’s source (the DSL or spec text) by its contentId, as listed by list_diagrams. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        cloudId: { type: 'string', description: 'From list_sites.' },
        contentId: { type: 'string', description: 'From list_diagrams.' },
      },
      required: ['cloudId', 'contentId'],
    },
  },
  {
    name: 'get_status',
    description:
      'Which mode this connection is in, who it acts as, and which ZenUML app each reachable site runs. Read-only.',
    inputSchema: { type: 'object', properties: {} },
  },
];

export class HeadlessToolError extends Error {
  constructor(
    message: string,
    readonly code: 'no_grant' | 'unknown_site' | 'not_found' | 'upstream' | 'bad_params',
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'HeadlessToolError';
  }
}

async function sitesFor(ctx: HeadlessContext) {
  const now = (ctx.nowMs ?? Date.now)();
  const token = await getAccessToken(ctx.store, ctx.secret, ctx.app, ctx.fetchImpl, ctx.userId, now);
  if (!token.ok) {
    // 'reauthorize_required' is the user's to fix and says so; the others are
    // transient and must not be reported as "you are logged out".
    throw new HeadlessToolError(
      token.reason === 'reauthorize_required'
        ? 'Your Atlassian authorization has ended. Authorize ZenUML again to continue.'
        : 'Could not reach Atlassian to refresh your authorization. Try again shortly.',
      'no_grant',
      token.reason,
    );
  }
  const sites = await listAccessibleSites(ctx.fetchImpl, token.accessToken);
  if (!sites.ok) throw new HeadlessToolError('Could not list your Atlassian sites.', 'upstream', sites.detail);
  return sites.sites;
}

/**
 * A reader for `cloudId`, but only after checking the user can actually reach
 * that site. Skipping this would let any cloudId a caller invented be proxied
 * with the user's token — the token would refuse it, but only after we had
 * made the request on their behalf.
 */
async function readerFor(ctx: HeadlessContext, cloudId: string): Promise<ConfluenceGet> {
  const sites = await sitesFor(ctx);
  if (!sites.some((s) => s.cloudId === cloudId)) {
    throw new HeadlessToolError(
      'That site is not one your authorization can reach. Call list_sites for the ones it can.',
      'unknown_site',
    );
  }
  return confluenceReaderFor({
    store: ctx.store,
    secret: ctx.secret,
    app: ctx.app,
    fetchImpl: ctx.fetchImpl,
    userId: ctx.userId,
    cloudId,
  });
}

interface CustomContentRow {
  id?: unknown;
  title?: unknown;
  type?: unknown;
  version?: { createdAt?: unknown; number?: unknown };
  pageId?: unknown;
  spaceId?: unknown;
}

function diagramRow(row: CustomContentRow) {
  return {
    contentId: typeof row.id === 'string' ? row.id : String(row.id ?? ''),
    title: typeof row.title === 'string' ? row.title : '',
    type: typeof row.type === 'string' ? row.type : '',
    pageId: typeof row.pageId === 'string' ? row.pageId : undefined,
    modifiedAt: typeof row.version?.createdAt === 'string' ? row.version.createdAt : undefined,
  };
}

export async function callHeadlessTool(
  name: string,
  args: Record<string, unknown>,
  ctx: HeadlessContext,
): Promise<unknown> {
  switch (name) {
    case 'list_sites': {
      const sites = await sitesFor(ctx);
      return { sites: sites.map((s) => ({ cloudId: s.cloudId, name: s.name, url: s.url })) };
    }

    case 'get_status': {
      const sites = await sitesFor(ctx);
      // Resolving the identity is one probe per site; with several sites that
      // is several round trips, which is why it lives in get_status rather
      // than being done eagerly on every call.
      const rows = [];
      for (const site of sites) {
        const identity = await resolveMacroIdentity(await readerFor(ctx, site.cloudId));
        rows.push({
          cloudId: site.cloudId,
          url: site.url,
          variant: identity.ok ? identity.identity.variant : null,
          identity: identity.ok ? 'resolved' : identity.reason,
        });
      }
      return {
        mode: 'headless',
        // The account id, not a name or an email: it is what the grant is
        // keyed by, and it is the only identity we hold.
        actingAs: ctx.userId,
        capabilities: ['read'],
        sites: rows,
      };
    }

    case 'list_diagrams': {
      const cloudId = typeof args.cloudId === 'string' ? args.cloudId : '';
      if (!cloudId) throw new HeadlessToolError('cloudId is required; call list_sites first.', 'bad_params');
      const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
      const get = await readerFor(ctx, cloudId);

      const identity = await resolveMacroIdentity(get);
      if (!identity.ok) {
        throw new HeadlessToolError(
          identity.reason === 'no_macro_on_site'
            ? 'No ZenUML diagrams were found on that site.'
            : 'Could not work out which ZenUML app that site runs.',
          identity.reason === 'no_macro_on_site' ? 'not_found' : 'upstream',
          identity.reason,
        );
      }

      // Only OUR content types. A site's custom content is shared by every
      // app on it — an unfiltered listing on whimet4 came back full of
      // draw.io rows (2026-09-25) — and a caller asking for ZenUML diagrams
      // has no way to tell which of those are ours.
      const profile = VARIANTS.find((v) => v.variant === identity.identity.variant)!;
      const types = customContentTypesFor(profile);
      const pageId = typeof args.pageId === 'string' ? args.pageId : '';

      const rows: CustomContentRow[] = [];
      if (pageId) {
        // The page-scoped endpoint takes no type filter, so filter on the way out.
        const res = await get(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}/custom-content?limit=250`);
        if (res.status !== 200) {
          throw new HeadlessToolError('Confluence refused the listing.', 'upstream', { status: res.status });
        }
        for (const row of (res.body as { results?: CustomContentRow[] })?.results ?? []) {
          if (typeof row.type === 'string' && types.includes(row.type)) rows.push(row);
        }
      } else {
        for (const type of types) {
          const res = await get(`/wiki/api/v2/custom-content?type=${encodeURIComponent(type)}&limit=${limit}`);
          // A 404 is Confluence saying this variant never wrote that type —
          // information, not a failure (the same rule macroIdentity applies).
          if (res.status === 404) continue;
          if (res.status !== 200) {
            throw new HeadlessToolError('Confluence refused the listing.', 'upstream', { status: res.status });
          }
          rows.push(...((res.body as { results?: CustomContentRow[] })?.results ?? []));
        }
      }

      const diagrams = rows
        .map(diagramRow)
        .sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''))
        .slice(0, limit);
      return { cloudId, variant: identity.identity.variant, diagrams };
    }

    case 'read_diagram': {
      const cloudId = typeof args.cloudId === 'string' ? args.cloudId : '';
      const contentId = typeof args.contentId === 'string' ? args.contentId : '';
      if (!cloudId || !contentId) {
        throw new HeadlessToolError('cloudId and contentId are required.', 'bad_params');
      }
      const get = await readerFor(ctx, cloudId);
      const res = await get(`/wiki/api/v2/custom-content/${encodeURIComponent(contentId)}?body-format=raw`);
      if (res.status === 404) throw new HeadlessToolError('No diagram with that contentId.', 'not_found');
      if (res.status !== 200) {
        throw new HeadlessToolError('Confluence refused the read.', 'upstream', { status: res.status });
      }
      const body = res.body as {
        id?: unknown;
        title?: unknown;
        type?: unknown;
        version?: { number?: unknown };
        body?: { raw?: { value?: unknown } };
      };
      return {
        contentId,
        title: typeof body.title === 'string' ? body.title : '',
        type: typeof body.type === 'string' ? body.type : '',
        // The optimistic-lock value a future update_diagram will have to carry
        // (ADR 0003's context: a stale version is a 400, not a silent
        // overwrite). Surfaced now so a reader can see what it would send.
        version: typeof body.version?.number === 'number' ? body.version.number : undefined,
        source: typeof body.body?.raw?.value === 'string' ? body.body.raw.value : '',
      };
    }

    default:
      throw new HeadlessToolError(`Unknown tool: ${name}`, 'bad_params');
  }
}
