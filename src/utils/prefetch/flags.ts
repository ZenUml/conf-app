/**
 * Kill switch for the idle renderer prefetch — Forge feature flags.
 *
 * Uses the @forge/bridge client-side FeatureFlags SDK (bridge ≥ 5.15):
 * `initialize()` downloads the flag configuration once through the Forge
 * bridge, then `checkFlag()` evaluates locally and synchronously. No Forge
 * Function is invoked (zero GB-seconds) and our Cloudflare backend is not in
 * the path. Targeting (per-site via installContext, percentage rollouts,
 * per-environment) and toggling live in the Developer Console per app
 * (lite / full / diagramly are separate Forge apps — each needs the flags
 * created once).
 *
 * - `renderer-prefetch`        — master switch (macro-iframe host)
 * - `renderer-prefetch-banner` — page-banner host (requires master too)
 *
 * Fail-closed: any init/context error, the standalone (non-Forge) dev
 * environment, and flags that don't exist yet all evaluate to off
 * (`checkFlag` default false). No memoization here — the orchestrator's
 * once-per-deploy throttle already makes this a rare call, and a fresh
 * config read per attempt means Console toggles apply on the next attempt.
 */

import { getContext } from '@/model/globals/forgeGlobal';

export const MASTER_FLAG = 'renderer-prefetch';
export const BANNER_FLAG = 'renderer-prefetch-banner';

export interface PrefetchFlags {
  macroHost: boolean;
  bannerHost: boolean;
}

type FeatureFlagEnvironment = 'development' | 'staging' | 'production';

// Forge context reports DEVELOPMENT/STAGING/PRODUCTION; the SDK wants
// lowercase. Unknown/missing maps to 'production', where flags are off until
// explicitly configured — the fail-closed direction.
export function mapEnvironment(environmentType: unknown): FeatureFlagEnvironment {
  const env = typeof environmentType === 'string' ? environmentType.toLowerCase() : '';
  return env === 'development' || env === 'staging' ? env : 'production';
}

interface FlagClient {
  initialize(
    user: { identifiers?: { installContext?: string; accountId?: string } },
    config?: { environment: FeatureFlagEnvironment },
  ): Promise<void>;
  checkFlag(flagName: string, defaultValue?: boolean): boolean;
  shutdown(): void;
}

async function defaultCreateClient(): Promise<FlagClient> {
  const { FeatureFlags } = await import('@forge/bridge');
  return new FeatureFlags();
}

export async function getPrefetchFlags(deps?: {
  createClient?: () => Promise<FlagClient>;
  getForgeContext?: () => Promise<{ installContext?: string; environmentType?: string } | undefined>;
}): Promise<PrefetchFlags> {
  const off: PrefetchFlags = { macroHost: false, bannerHost: false };
  let client: FlagClient | undefined;
  try {
    const context = await (deps?.getForgeContext ?? getContext)();
    const installContext = context?.installContext;
    if (!installContext) return off; // standalone/dev — no install to target

    client = await (deps?.createClient ?? defaultCreateClient)();
    await client.initialize(
      { identifiers: { installContext } },
      { environment: mapEnvironment(context?.environmentType) },
    );
    const master = client.checkFlag(MASTER_FLAG, false);
    return {
      macroHost: master,
      bannerHost: master && client.checkFlag(BANNER_FLAG, false),
    };
  } catch {
    return off;
  } finally {
    try {
      client?.shutdown();
    } catch {
      // shutdown is best-effort cleanup
    }
  }
}
