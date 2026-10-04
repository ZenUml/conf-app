// Resolve the Forge macro identity — {appId, environmentId} — for one
// Confluence site, so a HEADLESS create can write an `extensionKey` that the
// installed app will actually render.
//
// See docs/superpowers/specs/2026-09-19-headless-diagram-mcp-design.md §6.
//
// WHY THIS EXISTS. The in-product path never needs this: `resolveIdentity()`
// in src/utils/byline/addToPage.ts reads appId and environmentId straight out
// of the running Forge context's `localId`, and refuses to return anything
// unless the two agree. A headless caller has no Forge context, so it either
// resolves the pair some other way or guesses — and guessing has already cost
// us once. addToPage.ts's header records it: a malformed key rendered as an
// unknown extension on a customer's page during the first live lite→full
// conversion (2026-08-11, job c5a6d954). A wrong extensionKey does not fail
// loudly; it publishes a broken macro into somebody's page history.
//
// WHAT IS KNOWN vs WHAT MUST BE DISCOVERED. Per-variant identity (appId,
// connect key, macro keys) is constant and public — it is templated into every
// `forge:deploy:*` script in package.json. Two things are NOT derivable:
//
//   1. WHICH variant is installed on a given site.
//   2. That install's `environmentId` (a per-app, per-environment UUID that
//      only `forge environments list` or an existing macro node can tell us).
//
// So the algorithm is: use the custom-content TYPE to identify the variant,
// then lift the environmentId from a real macro node written by that install.
//
// The type is the lever because it carries no environment and no appId. It is
// `ac:<connectKey>:<contentKey>` (ApWrapper2.getCustomContentTypePrefix), and
// the connect key is fixed per variant. There are exactly six such strings
// across all four variants, so a site can be classified by probing them.
//
// LIFT THE PREFIX, COMPOSE THE KEY. The node we find might be any macro
// (`zenuml-graph-macro` when the caller wants a sequence macro), so we take
// the `<appId>/<environmentId>/static/` half verbatim — the half we cannot
// derive — and compose the macro key ourselves from the variant's own
// constants. Lifting the whole string would bind every create to whichever
// macro type happened to be on the page we sampled.
//
// THE CROSS-CHECK. The appId in the lifted key must match the appId the
// custom-content type implies. Two independent signals agreeing is the
// headless equivalent of `resolveIdentity`'s localId-vs-environmentId check;
// when they disagree something is wrong with our assumptions rather than with
// the page, so we refuse. Refusing is a correct outcome here, not a gap.

/** The four shipped variants. Mirrors the `forge:deploy:*` scripts in package.json. */
export type Variant = 'lite' | 'full' | 'diagramly' | 'asyncapi';

export interface VariantProfile {
  variant: Variant;
  /** APP_ID from package.json's forge:deploy:<variant>:* scripts. Public; also in manifest.yml. */
  appId: string;
  /** CONNECT_KEY — the `ac:<connectKey>:` half of every custom-content type this variant writes. */
  connectKey: string;
  /** SEQUENCE_MACRO_KEY — hosts sequence/mermaid/plantuml, and on asyncapi the AsyncAPI editor. */
  sequenceMacroKey: string;
  /** Content keys this variant actually writes. Empty types are never probed. */
  contentKeys: string[];
  /** LITE_KEY_SUFFIX — appended to every macro module key. Lite only. */
  macroKeySuffix: string;
}

/**
 * Every variant's fixed identity, straight from package.json's deploy scripts.
 *
 * Deliberately duplicated here rather than imported from src/: this module runs
 * in the Cloudflare Worker, where `forgeGlobal` (which is how the frontend
 * picks a variant — it reads its own build) does not exist and would be the
 * wrong question anyway. The frontend asks "which variant am I?"; this asks
 * "which variant is installed over there?", which only the site can answer.
 */
export const VARIANTS: readonly VariantProfile[] = [
  {
    variant: 'lite',
    appId: '8ad26115-211f-4216-971b-0540f606303d',
    connectKey: 'com.zenuml.confluence-addon-lite',
    sequenceMacroKey: 'zenuml-sequence-macro',
    contentKeys: ['zenuml-content-sequence', 'zenuml-content-graph'],
    macroKeySuffix: '-lite',
  },
  {
    variant: 'full',
    appId: 'd9e4002b-120b-426b-834b-402a4a5adce7',
    connectKey: 'com.zenuml.confluence-addon',
    sequenceMacroKey: 'zenuml-sequence-macro',
    contentKeys: ['zenuml-content-sequence', 'zenuml-content-graph'],
    macroKeySuffix: '',
  },
  {
    // Diagramly stores EVERY diagram under one key — see ApWrapper2's
    // DIAGRAMLY_CUSTOM_CONTENT_TYPES comment and #524, where probing for the
    // lite/full types on Diagramly returned nothing and every discovery
    // caller came back empty.
    variant: 'diagramly',
    appId: '01ede8b1-4e88-451a-b9ef-89eeef93afaf',
    connectKey: 'gptdock-confluence',
    sequenceMacroKey: 'gpt-diagram-macro',
    contentKeys: ['gpt-custom-content-key'],
    macroKeySuffix: '',
  },
  {
    // `ac:my-api:async-api-doc` is inherited from the standalone
    // AsyncAPI-Conf-V2 app so migrated customer documents stay readable.
    variant: 'asyncapi',
    appId: '49017727-af19-4ab6-8d5a-7d28108936b6',
    connectKey: 'my-api',
    sequenceMacroKey: 'zenuml-asyncapi-macro',
    contentKeys: ['async-api-doc'],
    macroKeySuffix: '',
  },
] as const;

/** `ac:<connectKey>:<contentKey>` — ApWrapper2.customContentType's shape, for a variant we are probing rather than running as. */
export function customContentTypesFor(profile: VariantProfile): string[] {
  return profile.contentKeys.map((key) => `ac:${profile.connectKey}:${key}`);
}

/** A resolved identity: enough to compose any of this install's extension keys. */
export interface MacroIdentity {
  appId: string;
  environmentId: string;
  variant: Variant;
}

export type IdentityFailureReason =
  | 'no_macro_on_site'
  | 'no_extension_node'
  | 'app_id_mismatch'
  | 'probe_failed';

/** Mirrors AgentLinkMacroKeySource in src/utils/analytics/catalog.ts — the value the
 * agent_link_identity_resolved event carries as `macro_key_source`. */
export type IdentitySource = 'cached' | 'discovered';

export type IdentityResult =
  | { ok: true; identity: MacroIdentity; source: IdentitySource }
  | { ok: false; reason: IdentityFailureReason; detail?: string };

const UUID = '[0-9a-fA-F-]{36}';
/**
 * The `<appId>/<environmentId>/static/<macroKey>` shape written into every
 * Forge macro node's `extensionKey`. Anchored at both ends and UUID-shaped on
 * both ids, so a truncated or reordered key fails to parse rather than
 * yielding half an identity — the failure mode addToPage.ts's header records.
 */
const EXTENSION_KEY_RE = new RegExp(`^(${UUID})/(${UUID})/static/([A-Za-z0-9._-]+)$`);

export function parseExtensionKey(
  key: unknown,
): { appId: string; environmentId: string; macroKey: string } | null {
  if (typeof key !== 'string') return null;
  const match = EXTENSION_KEY_RE.exec(key.trim());
  if (!match) return null;
  return { appId: match[1], environmentId: match[2], macroKey: match[3] };
}

/**
 * The macro module key this variant renders `diagramType` with.
 *
 * Composed, never lifted — see the file header. Mirrors
 * MACRO_KEY_BY_DIAGRAM_TYPE in src/utils/byline/addToPage.ts, including the
 * rule that the text-DSL family (sequence/mermaid/plantuml) shares one macro
 * exactly as it shares one custom-content type.
 */
export function macroKeyFor(identity: MacroIdentity, diagramType: string): string | null {
  const profile = VARIANTS.find((v) => v.variant === identity.variant);
  if (!profile) return null;

  const folded = String(diagramType).toLowerCase();
  let base: string | null = null;
  if (folded === 'sequence' || folded === 'mermaid' || folded === 'plantuml') {
    base = profile.sequenceMacroKey;
  } else if (folded === 'graph') {
    // Diagramly and AsyncAPI ship no graph macro; their manifests register a
    // single diagram macro each.
    base = identity.variant === 'lite' || identity.variant === 'full' ? 'zenuml-graph-macro' : null;
  } else if (folded === 'openapi') {
    // Present on lite/full AND asyncapi — the asyncapi manifest strip keeps
    // zenuml-openapi-macro (CLAUDE.md, Product variants).
    base = identity.variant === 'diagramly' ? null : 'zenuml-openapi-macro';
  } else if (folded === 'asyncapi') {
    base = identity.variant === 'asyncapi' ? profile.sequenceMacroKey : null;
  }

  return base === null ? null : base + profile.macroKeySuffix;
}

/** The full `extensionKey` for one diagram type on one install. */
export function extensionKeyFor(identity: MacroIdentity, diagramType: string): string | null {
  const macroKey = macroKeyFor(identity, diagramType);
  if (!macroKey) return null;
  return `${identity.appId}/${identity.environmentId}/static/${macroKey}`;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * The single Confluence call this module needs, injected rather than imported.
 *
 * Phase 1 ships before any OAuth exists (design §11), so the resolver must be
 * exercisable against a real site with an API token today and swap to a bearer
 * later without changing a line here. `status` is carried separately from the
 * body so a 403 on one probe can be told apart from a site that genuinely has
 * no macros — the difference between 'probe_failed' and 'no_macro_on_site',
 * which are a retry and a refusal respectively.
 */
export type ConfluenceGet = (path: string) => Promise<{ status: number; body: unknown }>;

interface CustomContentHit {
  contentId: string;
  pageId: string;
}

/** One page of v2 custom-content results, narrowed to what discovery uses. */
function readCustomContentHits(body: unknown): CustomContentHit[] {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const hits: CustomContentHit[] = [];
  for (const row of results) {
    const r = row as { id?: unknown; pageId?: unknown };
    if (r?.id === undefined || r?.pageId === undefined) continue;
    hits.push({ contentId: String(r.id), pageId: String(r.pageId) });
  }
  return hits;
}

/**
 * Walk an ADF document and return every `extension` node's
 * {extensionKey, customContentId}.
 *
 * Reads `guestParams.customContentId` the way buildMacroNode writes it, and
 * tolerates the kebab spelling the create-test-page script emits, because a
 * site may carry nodes from either. It does NOT resolve `autoConvertLink`
 * (which referencedCustomContent.ts does): a pasted-but-never-saved macro has
 * no stored binding, and discovery needs a node whose key we can trust, not
 * every node that might eventually point somewhere.
 */
export function extensionNodesIn(
  adf: unknown,
): Array<{ extensionKey: string; customContentId: string | undefined }> {
  const found: Array<{ extensionKey: string; customContentId: string | undefined }> = [];

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const n = node as { type?: unknown; attrs?: any; content?: unknown };
    if (n.type === 'extension' || n.type === 'bodiedExtension' || n.type === 'inlineExtension') {
      const key = n.attrs?.extensionKey;
      if (typeof key === 'string') {
        const guest = n.attrs?.parameters?.guestParams ?? {};
        const raw = guest.customContentId ?? guest['custom-content-id'];
        const id = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : undefined;
        found.push({ extensionKey: key, customContentId: id });
      }
    }
    if (n.content !== undefined) visit(n.content);
  };

  visit(adf);
  return found;
}

/** Page bodies come back as a JSON STRING inside atlas_doc_format.value. */
function parsePageAdf(body: unknown): unknown | null {
  const raw =
    (body as any)?.body?.atlas_doc_format?.value ?? (body as any)?.body?.atlas_doc_format;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** How many custom-content hits to follow to a page before giving up. */
const MAX_PAGES_SAMPLED = 3;

/**
 * Resolve {appId, environmentId, variant} for the site behind `get`.
 *
 * Probes each variant's custom-content types in turn; the first that yields a
 * hit fixes the variant. Then follows up to MAX_PAGES_SAMPLED of those hits to
 * their container pages, looking for an extension node we can parse. The
 * sampling bound matters because orphaned custom content is a real state in
 * this codebase (ZEN-1170): the first hit may have no macro referencing it at
 * all, and one dead sample must not condemn the whole site.
 */
export async function resolveMacroIdentity(get: ConfluenceGet): Promise<IdentityResult> {
  let sawAnyContent = false;
  let lastProbeError: string | undefined;

  for (const profile of VARIANTS) {
    for (const type of customContentTypesFor(profile)) {
      const res = await get(
        `/wiki/api/v2/custom-content?type=${encodeURIComponent(type)}&limit=${MAX_PAGES_SAMPLED}`,
      );

      // A 404 on an unknown type is Confluence saying "not this variant", which
      // is information, not a failure. Anything else non-2xx is a real problem
      // and must not be reported as an empty site.
      if (res.status === 404) continue;
      if (res.status < 200 || res.status >= 300) {
        lastProbeError = `custom-content probe for ${type} returned ${res.status}`;
        continue;
      }

      const hits = readCustomContentHits(res.body);
      if (hits.length === 0) continue;
      sawAnyContent = true;

      for (const hit of hits.slice(0, MAX_PAGES_SAMPLED)) {
        const pageRes = await get(
          `/wiki/api/v2/pages/${encodeURIComponent(hit.pageId)}?body-format=atlas_doc_format`,
        );
        if (pageRes.status < 200 || pageRes.status >= 300) {
          lastProbeError = `page ${hit.pageId} returned ${pageRes.status}`;
          continue;
        }

        const adf = parsePageAdf(pageRes.body);
        if (adf === null) continue;

        const nodes = extensionNodesIn(adf);
        // Prefer the node that names this exact custom content; fall back to
        // any parseable node on the page, since every macro on a page rendered
        // by one install carries the same appId/environmentId.
        const exact = nodes.find((n) => n.customContentId === hit.contentId);
        for (const node of exact ? [exact, ...nodes] : nodes) {
          const parsed = parseExtensionKey(node.extensionKey);
          if (!parsed) continue;

          if (parsed.appId !== profile.appId) {
            // Two independent signals disagree. See the file header: refuse.
            return {
              ok: false,
              reason: 'app_id_mismatch',
              detail: `custom-content type implies ${profile.variant} (${profile.appId}) but extensionKey names ${parsed.appId}`,
            };
          }

          return {
            ok: true,
            source: 'discovered',
            identity: {
              appId: parsed.appId,
              environmentId: parsed.environmentId,
              variant: profile.variant,
            },
          };
        }
      }
    }
  }

  if (sawAnyContent) {
    return {
      ok: false,
      reason: 'no_extension_node',
      detail: lastProbeError ?? 'custom content exists but no page referenced it with a macro node',
    };
  }
  if (lastProbeError) {
    return { ok: false, reason: 'probe_failed', detail: lastProbeError };
  }
  return { ok: false, reason: 'no_macro_on_site' };
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

/**
 * Where a resolved identity is remembered between calls.
 *
 * Narrower than Cloudflare's KVNamespace on purpose — this module should be
 * testable with a Map, and callable with a KV binding, without either
 * knowing about the other.
 */
export interface IdentityStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** 30 days. An install's environmentId changes only when the app is reinstalled into a different environment. */
export const IDENTITY_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

export function identityCacheKey(cloudId: string): string {
  return `agent-link:macro-identity:${cloudId}`;
}

/**
 * `resolveMacroIdentity` with a per-cloudId memo.
 *
 * Only successes are cached. A refusal must stay live: 'no_macro_on_site' is
 * the state of a brand-new tenant, and the fix for it is the user inserting
 * one diagram by hand — caching that answer would keep telling them no for a
 * month after they had already done it.
 *
 * A cache read or write that throws is swallowed: the memo is an optimisation,
 * and a KV blip should cost a round-trip, not the call.
 */
export async function resolveMacroIdentityCached(
  get: ConfluenceGet,
  cloudId: string,
  store: IdentityStore,
): Promise<IdentityResult> {
  const key = identityCacheKey(cloudId);

  try {
    const cached = await store.get(key);
    if (cached) {
      const identity = JSON.parse(cached) as MacroIdentity;
      // Re-validate rather than trust: a stored blob that predates a change to
      // this module's shape must not be handed to a caller that will paste it
      // into an extensionKey.
      if (
        typeof identity?.appId === 'string' &&
        typeof identity?.environmentId === 'string' &&
        VARIANTS.some((v) => v.variant === identity.variant && v.appId === identity.appId)
      ) {
        return { ok: true, identity, source: 'cached' };
      }
    }
  } catch {
    // fall through to a live resolve
  }

  const result = await resolveMacroIdentity(get);
  if (result.ok) {
    try {
      await store.put(key, JSON.stringify(result.identity), {
        expirationTtl: IDENTITY_CACHE_TTL_SECONDS,
      });
    } catch {
      // see above — the answer is still good, it just will not be remembered
    }
  }
  return result;
}
