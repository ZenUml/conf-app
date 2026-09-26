// The headless tool surface: what an agent can do with the page closed.
//
// Every tool goes through the 3LO grant, so each call refreshes it if it has
// to and acts strictly as the user who consented. Nothing takes a cloudId on
// trust: a site must be one that `accessible-resources` returned for this
// user's grant, or the call is refused before any Confluence request goes out.
//
// THE WRITE TOOLS carry three properties from the paths that already exist,
// because each was paid for once already:
//
//   - `update_diagram` runs `guardUpdateDiagram` (parse + data-loss) against
//     the diagram's CURRENT stored DSL before writing. The relay path runs the
//     same guard; a headless write that skipped it would be the one way to
//     truncate a diagram that the product otherwise prevents.
//   - `create_diagram` treats `already_present` as success and `conflict` as a
//     refusal, exactly as addToPage.ts does (design §7). An agent that retries
//     must not duplicate a diagram, and an agent racing a human editor must
//     lose.
//   - `create_diagram` consults the server-side paywall gate first (§9.1,
//     headlessGate.ts). The frontend's gate never runs for a headless call, so
//     without this, creation here would be a revenue bypass.

import { listAccessibleSites, type AtlassianAppConfig, type FetchLike } from './atlassianClient';
import { confluenceReaderFor } from './confluenceReader';
import { confluenceRequestFor, type ConfluenceRequest } from './confluenceWriter';
import { checkCreateAllowed, type GateEnv } from './headlessGate';
import { buildMacroNode, countExtensions, referencesCustomContent } from '../macroNode';
import { guardUpdateDiagram } from '../updateDiagramGuard';
import { getAccessToken, type GrantStore } from './tokenStore';
import {
  customContentTypesFor,
  extensionKeyFor,
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
  /** The KV bindings the paywall gate reads (design 9.1). Only create_diagram needs them. */
  gateEnv?: GateEnv;
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
  {
    name: 'update_diagram',
    description:
      'Replace a diagram’s source with new DSL. Reads the current source first and refuses a change that fails to parse or looks like accidental truncation. Publishes one new version, so page history can revert it.',
    inputSchema: {
      type: 'object',
      properties: {
        cloudId: { type: 'string', description: 'From list_sites.' },
        contentId: { type: 'string', description: 'From list_diagrams.' },
        dsl: { type: 'string', description: 'The complete new source. Not a patch.' },
        summary: { type: 'string', description: 'Optional. Note for the version history.' },
      },
      required: ['cloudId', 'contentId', 'dsl'],
    },
  },
  {
    name: 'create_diagram',
    description:
      'Create a diagram and place it on a page: stores the source, then appends the macro and publishes one page version. Returns already_present if the page already carries it, and conflict if someone edited the page first (never overwrites).',
    inputSchema: {
      type: 'object',
      properties: {
        cloudId: { type: 'string', description: 'From list_sites.' },
        pageId: { type: 'string', description: 'The Confluence page to place it on.' },
        type: {
          type: 'string',
          description:
            'What the DSL is written in: sequence, mermaid, plantuml, graph or openapi. Case-insensitive; anything else is refused.',
        },
        dsl: { type: 'string', description: 'The diagram source.' },
        title: { type: 'string', description: 'Optional. Defaults to "Untitled diagram".' },
      },
      required: ['cloudId', 'pageId', 'type', 'dsl'],
    },
  },
];

export class HeadlessToolError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'no_grant'
      | 'unknown_site'
      | 'not_found'
      | 'upstream'
      | 'bad_params'
      | 'forbidden'
      | 'conflict'
      | 'guardrail_rejected'
      | 'limit_reached',
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

/** The site row for `cloudId`, or a refusal. Every write path starts here. */
async function assertReachable(ctx: HeadlessContext, cloudId: string) {
  const sites = await sitesFor(ctx);
  const site = sites.find((s) => s.cloudId === cloudId);
  if (!site) {
    throw new HeadlessToolError(
      'That site is not one your authorization can reach. Call list_sites for the ones it can.',
      'unknown_site',
    );
  }
  return site;
}

function requestFor(ctx: HeadlessContext, cloudId: string): ConfluenceRequest {
  return confluenceRequestFor({
    store: ctx.store,
    secret: ctx.secret,
    app: ctx.app,
    fetchImpl: ctx.fetchImpl,
    userId: ctx.userId,
    cloudId,
    nowMs: ctx.nowMs,
  });
}

/**
 * The stored diagram body: `{title, code, diagramType}` JSON in a `raw` body.
 *
 * Tolerant on purpose. Older records and other variants have carried extra
 * fields, and an update must preserve whatever it did not set rather than
 * rewrite the record to this module's idea of the shape.
 */
function parseStoredDiagram(value: unknown): { raw: Record<string, unknown>; code?: string; diagramType?: string } {
  if (typeof value !== 'string') return { raw: {} };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      raw: parsed,
      code: typeof parsed.code === 'string' ? parsed.code : undefined,
      diagramType: typeof parsed.diagramType === 'string' ? parsed.diagramType : undefined,
    };
  } catch {
    // Not JSON: treat the whole value as the source, which is what the
    // earliest records were.
    return { raw: {}, code: value };
  }
}

/**
 * The version message. §9.3: an agent's edit must be identifiable in page
 * history, so the agent is always named even when the caller supplies a note.
 */
function summaryFor(summary: unknown, title?: string): string {
  const note = typeof summary === 'string' && summary.trim() ? ` — ${summary.trim().slice(0, 200)}` : '';
  return title ? `Added ZenUML diagram "${title}" via Agent Link${note}` : `Updated by ZenUML Agent Link${note}`;
}

/**
 * The exact `diagramType` strings the app stores and compares against.
 *
 * Mirrors the DiagramType enum in src/model/Diagram/Diagram.ts, duplicated for
 * the same reason macroIdentity duplicates VARIANTS: this runs in a Worker,
 * where importing the frontend model is not possible. Note the enum is NOT
 * uniformly lowercase — 'OpenAPI' and 'AsyncAPI' are mixed case — and every
 * consumer compares with `===` (GenericViewer.vue's switches,
 * ApWrapper2.ts:454), so a value that differs only in case renders as
 * DiagramType.Unknown.
 *
 * This is why the caller's `type` is normalised rather than stored verbatim:
 * the first version wrote what the agent sent ('Sequence', 'Mermaid', as this
 * tool's own description asked for), which matched nothing and produced
 * macros that render as the wrong type.
 */
const DIAGRAM_TYPE_BY_FOLDED: Record<string, string> = {
  sequence: 'sequence',
  mermaid: 'mermaid',
  markdown: 'markdown',
  plantuml: 'plantuml',
  graph: 'graph',
  openapi: 'OpenAPI',
  asyncapi: 'AsyncAPI',
};

/** The canonical stored value for a caller-supplied type, or null if we do not know it. */
export function canonicalDiagramType(raw: string): string | null {
  return DIAGRAM_TYPE_BY_FOLDED[raw.trim().toLowerCase()] ?? null;
}

/**
 * Is this custom-content type one a ZenUML variant writes?
 *
 * Checked across ALL variants rather than the resolved one: a site can carry
 * content from an earlier variant (a lite→full conversion leaves both), and
 * refusing to edit a diagram we demonstrably wrote would be wrong. What this
 * excludes is the content every OTHER app on the site stores.
 */
function isZenUmlContentType(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  return VARIANTS.some((profile) => customContentTypesFor(profile).includes(type));
}

/** The custom-content type this variant stores `diagramType` under. */
function customContentTypeFor(identity: { variant: string; appId: string }, diagramType: string): string {
  const profile = VARIANTS.find((v) => v.variant === identity.variant)!;
  const types = customContentTypesFor(profile);
  const folded = diagramType.toLowerCase();
  // lite/full split sequence-family and graph across two types; diagramly and
  // asyncapi store everything under one, so `find` falling through to the
  // first entry is correct there rather than a guess.
  const graph = types.find((t) => t.endsWith('-graph'));
  if (folded === 'graph' && graph) return graph;
  return types.find((t) => !t.endsWith('-graph')) ?? types[0];
}

/**
 * The space key for a page, read out of the page response we already have.
 *
 * NOT from `/wiki/api/v2/spaces/{id}`: that endpoint needs
 * `read:space:confluence`, which REQUIRED_SCOPES deliberately does not ask
 * for, so it answers 401 "scope does not match" every time (verified against
 * a real site 2026-09-26). The first version of this called it anyway and
 * swallowed the failure, which silently handed the paywall gate an empty
 * space key — and an empty key misses both the licence lookup and the macro
 * count, so §9.1's gate could never fire in production.
 *
 * `_links.webui` is `/spaces/<KEY>/pages/<id>/<slug>` and is covered by the
 * page read itself.
 */
export function spaceKeyFromLinks(links: unknown): string {
  const webui = (links as { webui?: unknown })?.webui;
  if (typeof webui !== 'string') return '';
  const match = /^\/spaces\/([^/]+)\//.exec(webui);
  return match ? decodeURIComponent(match[1]) : '';
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

    case 'update_diagram': {
      const cloudId = typeof args.cloudId === 'string' ? args.cloudId : '';
      const contentId = typeof args.contentId === 'string' ? args.contentId : '';
      const dsl = typeof args.dsl === 'string' ? args.dsl : '';
      if (!cloudId || !contentId || !dsl) {
        throw new HeadlessToolError('cloudId, contentId and dsl are required.', 'bad_params');
      }
      await assertReachable(ctx, cloudId);
      const request = requestFor(ctx, cloudId);

      const read = await request(`/wiki/api/v2/custom-content/${encodeURIComponent(contentId)}?body-format=raw`);
      if (read.status === 404) throw new HeadlessToolError('No diagram with that contentId.', 'not_found');
      if (read.status === 403) throw new HeadlessToolError('You do not have permission to edit that diagram.', 'forbidden');
      if (!read.ok) throw new HeadlessToolError('Could not read the diagram.', 'upstream', { status: read.status });

      const current = read.body as {
        id?: unknown;
        type?: unknown;
        status?: unknown;
        pageId?: unknown;
        title?: unknown;
        version?: { number?: unknown };
        body?: { raw?: { value?: unknown } };
      };
      // Ours, or nothing. A site's custom content is shared by every app on
      // it, and without this check an agent handed (or guessing) a draw.io
      // contentId would have its XML body replaced with our JSON — the user's
      // drawing destroyed, under a version message naming Agent Link. The
      // caller's own permissions do not protect them here: they can edit that
      // content, they just never asked us to.
      if (!isZenUmlContentType(current.type)) {
        throw new HeadlessToolError(
          'That content is not a ZenUML diagram. Use list_diagrams for the ones this tool can edit.',
          'bad_params',
          { type: typeof current.type === 'string' ? current.type : undefined },
        );
      }

      const stored = parseStoredDiagram(current.body?.raw?.value);

      // The guard, against the CURRENT stored DSL — the same check the relay
      // path runs. A headless write that skipped it would be the one way to
      // truncate a diagram that the product otherwise prevents.
      const verdict = await guardUpdateDiagram(dsl, { diagramType: stored.diagramType, dsl: stored.code });
      if (!verdict.ok) {
        throw new HeadlessToolError(verdict.message, 'guardrail_rejected', {
          reason: verdict.reason,
          errors: verdict.errors,
          input_len: verdict.input_len,
          output_len: verdict.output_len,
        });
      }

      const versionNumber = Number(current.version?.number);
      const nextBody = { ...stored.raw, code: dsl };
      const write = await request(`/wiki/api/v2/custom-content/${encodeURIComponent(contentId)}`, {
        method: 'PUT',
        body: {
          id: String(current.id ?? contentId),
          type: current.type,
          status: typeof current.status === 'string' ? current.status : 'current',
          pageId: current.pageId,
          title: typeof current.title === 'string' ? current.title : 'Untitled diagram',
          body: { value: JSON.stringify(nextBody), representation: 'raw' },
          version: {
            number: (Number.isFinite(versionNumber) ? versionNumber : 0) + 1,
            // §9.3: page history must show which edits an agent made.
            message: summaryFor(args.summary),
          },
        },
      });
      if (write.status === 403) throw new HeadlessToolError('You do not have permission to edit that diagram.', 'forbidden');
      // Confluence answers a stale version with 409 (or 400 "Version must be
      // incremented"); either way somebody else wrote first and we do not
      // force. The agent should re-read and decide, not retry blindly.
      if (write.status === 409 || write.status === 400) {
        throw new HeadlessToolError('Someone else changed this diagram first. Read it again before updating.', 'conflict', {
          status: write.status,
        });
      }
      if (!write.ok) throw new HeadlessToolError('Confluence refused the update.', 'upstream', { status: write.status });

      return {
        result: 'updated',
        contentId,
        version: (Number.isFinite(versionNumber) ? versionNumber : 0) + 1,
        diff: verdict.diff,
        unvalidated: verdict.unvalidated,
      };
    }

    case 'create_diagram': {
      const cloudId = typeof args.cloudId === 'string' ? args.cloudId : '';
      const pageId = typeof args.pageId === 'string' ? args.pageId : '';
      const diagramType = typeof args.type === 'string' ? args.type : '';
      const dsl = typeof args.dsl === 'string' ? args.dsl : '';
      if (!cloudId || !pageId || !diagramType || !dsl) {
        throw new HeadlessToolError('cloudId, pageId, type and dsl are required.', 'bad_params');
      }
      // Normalised before anything else: the stored value has to be one the
      // viewer recognises, and an unknown type is a refusal rather than a
      // macro that renders as Unknown on the user's page.
      const storedType = canonicalDiagramType(diagramType);
      if (!storedType) {
        throw new HeadlessToolError(
          `Unknown diagram type "${diagramType}". Use one of: sequence, mermaid, plantuml, graph, openapi.`,
          'bad_params',
        );
      }

      const site = await assertReachable(ctx, cloudId);
      const request = requestFor(ctx, cloudId);
      const get: ConfluenceGet = async (path) => {
        const res = await request(path);
        return { status: res.status, body: res.body };
      };

      const identity = await resolveMacroIdentity(get);
      if (!identity.ok) {
        throw new HeadlessToolError(
          'Could not work out which ZenUML app that site runs, so the macro key cannot be built.',
          'upstream',
          identity.reason,
        );
      }
      // Refuse rather than guess: a malformed extensionKey renders as an
      // unknown extension on a customer's page (addToPage.ts, 2026-08-11).
      const extensionKey = extensionKeyFor(identity.identity, storedType);
      if (!extensionKey) {
        throw new HeadlessToolError(
          `That site's ZenUML app (${identity.identity.variant}) has no macro for diagram type "${storedType}".`,
          'bad_params',
        );
      }

      // Read the page BEFORE creating anything: a create followed by a
      // forbidden page write would leave orphaned content the user never
      // asked for and cannot see.
      const pageRead = await request(
        `/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=atlas_doc_format`,
      );
      if (pageRead.status === 403) throw new HeadlessToolError('You do not have permission to read that page.', 'forbidden');
      if (pageRead.status === 404) throw new HeadlessToolError('No page with that id.', 'not_found');
      if (!pageRead.ok) throw new HeadlessToolError('Could not read the page.', 'upstream', { status: pageRead.status });

      const page = pageRead.body as {
        title?: unknown;
        spaceId?: unknown;
        version?: { number?: unknown };
        body?: { atlas_doc_format?: { value?: unknown } };
        _links?: unknown;
      };
      const rawAdf = page.body?.atlas_doc_format?.value;
      const pageVersion = Number(page.version?.number);
      if (typeof rawAdf !== 'string' || !Number.isFinite(pageVersion)) {
        throw new HeadlessToolError('That page has no readable body.', 'upstream');
      }
      let adf: { content?: unknown[] };
      try {
        adf = JSON.parse(rawAdf);
      } catch {
        throw new HeadlessToolError('That page body could not be parsed.', 'upstream');
      }
      if (!Array.isArray(adf.content)) throw new HeadlessToolError('That page body could not be parsed.', 'upstream');

      // §9.1, blocking: the frontend paywall never runs for a headless call.
      const spaceKey = spaceKeyFromLinks(page._links);
      const gate = await checkCreateAllowed(ctx.gateEnv ?? {}, {
        variant: identity.identity.variant,
        cloudId,
        clientDomain: new URL(site.url).host,
        spaceKey,
        accountId: ctx.userId,
      });
      if (!gate.allowed) {
        throw new HeadlessToolError(
          `This space is on the free plan and already has ${gate.macroCount} of ${gate.limit} diagrams. Upgrade the space to add more.`,
          'limit_reached',
          gate,
        );
      }

      const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : 'Untitled diagram';
      const created = await request('/wiki/api/v2/custom-content', {
        method: 'POST',
        body: {
          type: customContentTypeFor(identity.identity, storedType),
          title,
          pageId,
          body: { value: JSON.stringify({ title, code: dsl, diagramType: storedType }), representation: 'raw' },
        },
      });
      if (created.status === 403) throw new HeadlessToolError('You do not have permission to create content here.', 'forbidden');
      if (!created.ok) throw new HeadlessToolError('Confluence refused to store the diagram.', 'upstream', { status: created.status });
      const contentId = String((created.body as { id?: unknown })?.id ?? '');
      if (!contentId) throw new HeadlessToolError('Confluence stored the diagram but returned no id.', 'upstream');

      // Already there? Only possible on a retry that re-created content, but
      // the check is cheap and `already_present` is a first-class success
      // (design §7): an agent that retries must not duplicate a diagram.
      if (referencesCustomContent(adf, contentId, cloudId)) {
        return { result: 'already_present', contentId, pageId };
      }

      adf.content.push(buildMacroNode(extensionKey, contentId, (ctx.nowMs ?? Date.now)()));
      const published = await request(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, {
        method: 'PUT',
        body: {
          id: String(pageId),
          status: 'current',
          title: page.title,
          version: { number: pageVersion + 1, message: summaryFor(args.summary, title) },
          body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) },
        },
      });
      if (published.status === 403) {
        throw new HeadlessToolError('The diagram was saved, but you do not have permission to edit that page.', 'forbidden', {
          contentId,
        });
      }
      // Never force-publish over a concurrent edit (design §7): an agent
      // racing a human editor must lose. The content is stored, so the user
      // can still place it; the page is untouched.
      if (published.status === 409 || published.status === 400) {
        return { result: 'conflict', contentId, pageId, detail: 'the page changed while the diagram was being added' };
      }
      if (!published.ok) {
        throw new HeadlessToolError('The diagram was saved, but the page update failed.', 'upstream', {
          contentId,
          status: published.status,
        });
      }

      return {
        result: 'added',
        contentId,
        pageId,
        pageVersion: pageVersion + 1,
        macroCount: countExtensions(adf),
        gate: gate.reason,
      };
    }

    default:
      throw new HeadlessToolError(`Unknown tool: ${name}`, 'bad_params');
  }
}
