/**
 * Feature flag for the #382 viewport render gate — Forge feature flags via
 * the @forge/bridge client-side FeatureFlags SDK, same pattern (and same
 * rationale) as utils/prefetch/flags.ts: `initialize()` pulls the flag
 * config once through the bridge, `checkFlag()` evaluates locally, no Forge
 * Function invocation, toggles live in the Developer Console per app.
 *
 * - `viewport-gated-render` — master switch for the viewer viewport gate.
 *
 * Fail-closed: any init/context error, the standalone dev environment, and
 * a not-yet-created flag all evaluate to off (gate disabled → render
 * immediately, exactly today's behavior).
 */

import { getContext } from "@/model/globals/forgeGlobal";
import { mapEnvironment } from "@/utils/prefetch/flags";

export const VIEWPORT_GATE_FLAG = "viewport-gated-render";

interface FlagClient {
  initialize(
    user: {
      attributes?: Record<string, string | number>;
      identifiers?: { installContext?: string; accountId?: string };
    },
    config?: { environment: "development" | "staging" | "production" },
  ): Promise<void>;
  checkFlag(flagName: string, defaultValue?: boolean): boolean;
  shutdown(): void;
}

async function defaultCreateClient(): Promise<FlagClient> {
  const { FeatureFlags } = await import("@forge/bridge");
  return new FeatureFlags();
}

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

export async function getViewportGateFlag(deps?: {
  createClient?: () => Promise<FlagClient>;
  getForgeContext?: () => Promise<
    { cloudId?: string; accountId?: string; environmentType?: string } | undefined
  >;
}): Promise<boolean> {
  let client: FlagClient | undefined;
  try {
    const context = await (deps?.getForgeContext ?? getContext)();
    const cloudId = context?.cloudId;
    if (!cloudId) {
      console.debug("[viewport-gate] flag off: no cloudId in context");
      return false;
    }
    client = await (deps?.createClient ?? defaultCreateClient)();
    await client.initialize(
      {
        attributes: { installContext: `ari:cloud:confluence::site/${cloudId}` },
        identifiers: { accountId: context?.accountId },
      },
      { environment: mapEnvironment(context?.environmentType) },
    );
    const on = client.checkFlag(VIEWPORT_GATE_FLAG, false);
    console.debug("[viewport-gate] flag", mapEnvironment(context?.environmentType), on);
    return on;
  } catch (e) {
    console.debug("[viewport-gate] flag off: evaluation failed", e);
    return false;
  } finally {
    try {
      client?.shutdown();
    } catch {
      // shutdown is best-effort cleanup
    }
  }
}
