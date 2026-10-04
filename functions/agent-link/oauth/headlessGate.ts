// The server-side paywall check that design §9.1 makes BLOCKING for headless
// creation.
//
// Why it exists: the Lite limit is enforced in the frontend
// (src/utils/paywall/), and a headless `create_diagram` never loads that code.
// Without a check here, an agent could create unlimited macros on an
// over-limit unpaid Lite space — a second, cleaner bypass on top of the
// fail-open leak already tracked in #302. §9.1 is explicit that this is
// blocking for create, "not follow-up", because shipping creation without it
// ships a revenue leak.
//
// What it is NOT: a re-implementation of the frontend's policy. It reads the
// same two facts from the same two stores the product already uses — whether
// the space is licensed (SPACE_LICENSE_KV, the store functions/api/
// space-status.ts reads) and how many macros the space holds (the metrics KV
// that functions/metrics-cache/query.ts serves) — and refuses creation only in
// the one case both agree on: an unpaid space already at or past the limit.
//
// FAIL-OPEN, deliberately and narrowly. A missing metrics record means we do
// not know the count, not that it is zero; refusing on a KV miss would block
// legitimate creation on every space the snapshot has not covered yet. This
// matches the frontend's own behaviour on an unknown count (#302, the
// `macro_count_source: 'undefined'` path) rather than inventing a stricter
// rule that only agents would ever hit.
//
// `update_diagram` is NOT gated: §9.1 — updating an existing diagram is not a
// create and consumes no limit.

/** Mirrors MACROS_LIMIT in src/composables/useCustomerSuccessService.ts. */
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

export type GateDecision =
  | { allowed: true; reason: 'paid' | 'under_limit' | 'count_unknown'; macroCount?: number }
  | { allowed: false; reason: 'limit_reached'; macroCount: number; limit: number };

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
  if (count >= MACROS_LIMIT) {
    return { allowed: false, reason: 'limit_reached', macroCount: count, limit: MACROS_LIMIT };
  }
  return { allowed: true, reason: 'under_limit', macroCount: count };
}
