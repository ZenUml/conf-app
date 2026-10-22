// The server-side paywall classification for headless creation (design §9.1).
//
// §9.1 originally made this BLOCKING: an unpaid Lite space at or past the
// limit was refused. The frontend block it mirrored was retired in 2026-09
// (useCustomerSuccessService.ts: `shouldBlockActions` is always false; only
// the warning banner remains), so refusing here left agents stricter than the
// UI. The gate now never refuses; it only says which branch a create fell in,
// so analytics can still show creates on over-limit spaces ('over_limit').
//
// It reads the same two facts from the same two stores the product already
// uses — whether the space is licensed (SPACE_LICENSE_KV, the store
// functions/api/space-status.ts reads) and how many macros the space holds
// (the metrics KV that functions/metrics-cache/query.ts serves). A missing
// metrics record means the count is unknown, not zero ('count_unknown').
//
// `update_diagram` is NOT gated: §9.1 — updating an existing diagram is not a
// create and consumes no limit.

/** Mirrors MACROS_LIMIT in src/composables/useCustomerSuccessService.ts. Classifies only; never refuses. */
export const MACROS_LIMIT = 100;

export interface SpaceLicenseRecordLike {
  status?: string;
  expiresAt?: string;
}

export interface GateEnv {
  SPACE_LICENSE_KV?: {
    get(key: string): Promise<string | null>;
  };
  confluence_plugin_features?: {
    get(key: string, type: 'json'): Promise<unknown>;
  };
}

export interface GateDecision {
  allowed: true;
  reason: 'paid' | 'under_limit' | 'over_limit' | 'count_unknown';
  macroCount?: number;
}

function isLive(record: SpaceLicenseRecordLike | null): boolean {
  if (!record) return false;
  if (record.status !== 'active') return false;
  const expires = record.expiresAt ? new Date(record.expiresAt) : null;
  return !expires || expires.getTime() > Date.now();
}

async function readLicense(env: GateEnv, key: string): Promise<SpaceLicenseRecordLike | null> {
  const raw = await env.SPACE_LICENSE_KV?.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SpaceLicenseRecordLike;
  } catch {
    return null;
  }
}

/**
 * Is this space licensed for `accountId`?
 *
 * Both key shapes space-status.ts uses, in its order: the user-scoped
 * extension first, then the space-level record. The D1 "paid rail"
 * suppression it also consults is intentionally not replicated — it widens
 * who counts as paid, so omitting it can only make this check stricter, and a
 * D1 binding is not available to every environment that serves this endpoint.
 */
export async function spaceIsPaid(
  env: GateEnv,
  cloudId: string,
  spaceKey: string,
  accountId?: string,
): Promise<boolean> {
  if (!env.SPACE_LICENSE_KV) return false;
  if (accountId && isLive(await readLicense(env, `license:${cloudId}:${spaceKey}:${accountId}`))) return true;
  return isLive(await readLicense(env, `license:${cloudId}:${spaceKey}`));
}

/**
 * Macros counted in this space, or null when we do not know.
 *
 * The key is `metrics:<clientDomain>:<productType>` — the same one
 * functions/metrics-cache/snapshot/common.ts builds — so this reads exactly
 * what the frontend's gate reads, rather than a second count that could
 * disagree with it.
 */
export async function macroCountFor(
  env: GateEnv,
  clientDomain: string,
  productType: string,
  spaceKey: string,
): Promise<number | null> {
  if (!env.confluence_plugin_features) return null;
  try {
    const domain = (await env.confluence_plugin_features.get(
      `metrics:${clientDomain}:${productType}`,
      'json',
    )) as { spaces?: Record<string, { total?: unknown }> } | null;
    const total = domain?.spaces?.[spaceKey]?.total;
    return typeof total === 'number' ? total : null;
  } catch {
    // A metrics read that throws must not fail a create; see the fail-open
    // note in this file's header.
    return null;
  }
}

/**
 * May a headless caller create a diagram in this space?
 *
 * Lite only. The limit is a Lite concept, and applying it to Full, Diagramly
 * or AsyncAPI would invent a restriction those products do not have.
 */
export async function checkCreateAllowed(
  env: GateEnv,
  opts: {
    variant: string;
    cloudId: string;
    clientDomain: string;
    spaceKey: string;
    accountId?: string;
  },
): Promise<GateDecision> {
  if (opts.variant !== 'lite') return { allowed: true, reason: 'paid' };
  if (await spaceIsPaid(env, opts.cloudId, opts.spaceKey, opts.accountId)) {
    return { allowed: true, reason: 'paid' };
  }

  const count = await macroCountFor(env, opts.clientDomain, opts.variant, opts.spaceKey);
  if (count === null) return { allowed: true, reason: 'count_unknown' };
  if (count >= MACROS_LIMIT) return { allowed: true, reason: 'over_limit', macroCount: count };
  return { allowed: true, reason: 'under_limit', macroCount: count };
}
