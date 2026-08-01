/**
 * Feature flag for the #382 viewport render gate — a Forge Console flag
 * (utils/featureFlags/registry.ts), evaluated through the shared
 * utils/featureFlags/forgeFlagClient.ts one-shot evaluator.
 *
 * - `viewport-gated-render` — master switch for the viewer viewport gate.
 *
 * Fail-closed: any init/context error, the standalone dev environment, and
 * a not-yet-created flag all evaluate to off (gate disabled → render
 * immediately, exactly today's behavior).
 */

import { FORGE_FLAGS } from "@/utils/featureFlags/registry";
import { checkForgeFlag, type ForgeFlagDeps } from "@/utils/featureFlags/forgeFlagClient";

export const VIEWPORT_GATE_FLAG = FORGE_FLAGS.viewportGatedRender;

export const FLAG_CACHE_KEY = "zenuml.viewportGateFlag";
// Rollout latency ceiling: a Console toggle reaches a given browser on its
// first render after the cached value ages past this TTL.
const FLAG_CACHE_TTL_MS = 30 * 60_000;

/**
 * Critical-path flag read: returns the last cached verdict SYNCHRONOUSLY
 * (false when no cache) and refreshes the cache in the background when
 * missing/stale. The bridge FeatureFlags round-trip therefore never delays
 * a render — the cost of that guarantee is one render of staleness after a
 * Console toggle (bounded by the TTL).
 *
 * `scope` is the flag-evaluation identity (`cloudId|accountId|environment`).
 * The Custom UI iframe ORIGIN is shared across every tenant that installed
 * this app (see utils/draftStore.ts), so a cached verdict is only reusable
 * when it was produced for the same site + account + environment — a record
 * from any other scope is treated as no cache (#384 review F1).
 */
export function getViewportGateFlagFast(deps?: {
  fetchFlag?: () => Promise<boolean>;
  storage?: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  scope?: string;
}): boolean {
  const fetchFlag = deps?.fetchFlag ?? getViewportGateFlag;
  const now = deps?.now ?? Date.now;
  const scope = deps?.scope ?? "";
  let cached: { on: boolean; at: number; scope?: string } | null = null;
  try {
    const storage = deps?.storage ?? localStorage;
    const raw = storage.getItem(FLAG_CACHE_KEY);
    cached = raw ? (JSON.parse(raw) as { on: boolean; at: number; scope?: string }) : null;
    if (cached && typeof cached.on !== "boolean") cached = null;
  } catch {
    cached = null;
  }
  const usable = !!cached && cached.scope === scope;
  const fresh = usable && now() - cached!.at < FLAG_CACHE_TTL_MS;
  if (!fresh) {
    void fetchFlag()
      .then((on) => {
        try {
          (deps?.storage ?? localStorage).setItem(
            FLAG_CACHE_KEY,
            JSON.stringify({ on, at: now(), scope }),
          );
        } catch {
          // storage unavailable — next render just refreshes again
        }
      })
      .catch(() => undefined);
  }
  return usable ? cached!.on : false;
}

export async function getViewportGateFlag(deps?: ForgeFlagDeps): Promise<boolean> {
  const on = await checkForgeFlag("[viewport-gate]", VIEWPORT_GATE_FLAG, deps);
  console.debug("[viewport-gate] flag", on);
  return on;
}
