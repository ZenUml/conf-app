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
