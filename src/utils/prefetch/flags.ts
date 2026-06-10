/**
 * Kill switch for the idle renderer prefetch.
 *
 * Flags live in the existing `/api/features` KV JSON (functions/api/features.ts)
 * and are fetched via callRemote (Forge remote → Cloudflare backend) — the only
 * fetch path that works inside Forge CDN iframes. (FeatureService.ts fetches
 * `window.location.origin/api/features`, which inside a Forge iframe is the CDN
 * origin and never reaches our backend — that service is dormant; don't use it.)
 *
 * - `renderer-prefetch`        — master switch (macro-iframe host)
 * - `renderer-prefetch-banner` — page-banner host (requires master too)
 *
 * The evaluated result is memoized in localStorage for FLAG_MEMO_TTL_MS so the
 * flag-off path costs zero network on subsequent page loads. Worst-case kill
 * latency is therefore one TTL window for browsers that already memoized "on".
 * Fail-closed: unreachable backend or malformed JSON evaluates to off.
 */

import { callRemote } from '@/utils/requestUtil';
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters';
import type { FeatureFlags } from '@/types/feature-flags';
import type { KvStore } from './throttle';

export const MASTER_FLAG = 'renderer-prefetch';
export const BANNER_FLAG = 'renderer-prefetch-banner';
const FLAG_MEMO_KEY = 'zenuml:prefetch:flags';
const FLAG_MEMO_TTL_MS = 6 * 60 * 60 * 1000;

export interface PrefetchFlags {
  macroHost: boolean;
  bannerHost: boolean;
}

export function evaluateFlag(
  flags: FeatureFlags | null | undefined,
  name: string,
  clientDomain: string | undefined,
): boolean {
  const feature = flags?.flags?.[name];
  if (!feature?.enabled) return false;
  const domains = feature.rules?.domains;
  if (clientDomain && domains) {
    if (domains.exclude?.includes(clientDomain)) return false;
    if (domains.include?.includes(clientDomain)) return true;
  }
  return feature.rules?.default === true;
}

interface FlagMemo {
  at: number;
  macroHost: boolean;
  bannerHost: boolean;
}

function readMemo(store: KvStore, now: number): PrefetchFlags | null {
  try {
    const raw = store.getItem(FLAG_MEMO_KEY);
    if (!raw) return null;
    const memo = JSON.parse(raw) as FlagMemo;
    if (typeof memo.at !== 'number' || now - memo.at > FLAG_MEMO_TTL_MS) return null;
    return { macroHost: memo.macroHost === true, bannerHost: memo.bannerHost === true };
  } catch {
    return null;
  }
}

export async function getPrefetchFlags(deps?: {
  store?: KvStore;
  now?: number;
  fetchFlags?: () => Promise<FeatureFlags>;
  clientDomain?: string;
}): Promise<PrefetchFlags> {
  const now = deps?.now ?? Date.now();
  let store: KvStore | null = null;
  try {
    store = deps?.store ?? window.localStorage;
  } catch {
    store = null;
  }

  if (store) {
    const memo = readMemo(store, now);
    if (memo) return memo;
  }

  let result: PrefetchFlags = { macroHost: false, bannerHost: false };
  try {
    const fetchFlags = deps?.fetchFlags ?? (() => callRemote('/api/features', 'GET'));
    const flags = (await fetchFlags()) as FeatureFlags;
    const domain = deps?.clientDomain ?? getClientDomain();
    const master = evaluateFlag(flags, MASTER_FLAG, domain);
    result = {
      macroHost: master,
      bannerHost: master && evaluateFlag(flags, BANNER_FLAG, domain),
    };
  } catch {
    // fail-closed; memoized below so an outage doesn't cause refetch storms
  }

  if (store) {
    try {
      store.setItem(FLAG_MEMO_KEY, JSON.stringify({ at: now, ...result } satisfies FlagMemo));
    } catch {
      // quota/blocked — next load refetches
    }
  }
  return result;
}
