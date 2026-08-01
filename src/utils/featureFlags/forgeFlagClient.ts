/**
 * Shared one-shot evaluator for Forge Console flags (@forge/bridge
 * FeatureFlags SDK, bridge ≥ 5.15). `initialize()` downloads the flag config
 * once through the bridge, `checkFlag()` then evaluates locally and
 * synchronously — no Forge Function is invoked (zero GB-seconds) and our
 * Cloudflare backend is not in the path.
 *
 * This module owns the identity/env boilerplate that was previously
 * copy-pasted per flag module: build the install ARI from cloudId, pass
 * accountId as the bucketing identifier, map the Forge environment, and
 * fail closed. Consumers keep their own key constants (sourced from
 * utils/featureFlags/registry.ts) and their own result shaping.
 *
 * Fail-closed contract: the standalone (non-Forge) dev environment, a
 * missing cloudId, a not-yet-created flag, and any init/context error all
 * resolve to `undefined` here — callers coalesce that to their OFF value,
 * so a broken flag path always yields today's behavior.
 */

import { getContext } from '@/model/globals/forgeGlobal';
import { mapEnvironment, type FeatureFlagEnvironment } from '@/utils/forgeFlagEnvironment';

export interface FlagClient {
  initialize(
    user: {
      attributes?: Record<string, string | number>;
      identifiers?: { installContext?: string; accountId?: string };
    },
    config?: { environment: FeatureFlagEnvironment },
  ): Promise<void>;
  checkFlag(flagName: string, defaultValue?: boolean): boolean;
  shutdown(): void;
}

export interface ForgeFlagDeps {
  createClient?: () => Promise<FlagClient>;
  getForgeContext?: () => Promise<
    { cloudId?: string; accountId?: string; environmentType?: string } | undefined
  >;
}

async function defaultCreateClient(): Promise<FlagClient> {
  const { FeatureFlags } = await import('@forge/bridge');
  return new FeatureFlags();
}

/**
 * Initialize a throwaway flag client, run `evaluate` against it, shut it
 * down. Returns `undefined` when flags are unavailable (see the fail-closed
 * contract above). `label` prefixes the debug logs, e.g. `[viewport-gate]`.
 *
 * The Custom UI context has NO `installContext` field — the install ARI is
 * constructed from cloudId and passed as an ATTRIBUTE, with accountId as the
 * bucketing identifier (verified live on lite-dev, 2026-06-10).
 */
export async function evaluateForgeFlags<T>(
  label: string,
  evaluate: (client: FlagClient) => T,
  deps?: ForgeFlagDeps,
): Promise<T | undefined> {
  let client: FlagClient | undefined;
  try {
    const context = await (deps?.getForgeContext ?? getContext)();
    const cloudId = context?.cloudId;
    if (!cloudId) {
      console.debug(`${label} flag off: no cloudId in context`, Object.keys(context ?? {}));
      return undefined;
    }
    client = await (deps?.createClient ?? defaultCreateClient)();
    await client.initialize(
      {
        attributes: { installContext: `ari:cloud:confluence::site/${cloudId}` },
        identifiers: { accountId: context?.accountId },
      },
      { environment: mapEnvironment(context?.environmentType) },
    );
    return evaluate(client);
  } catch (e) {
    console.debug(`${label} flag off: evaluation failed`, e);
    return undefined;
  } finally {
    try {
      client?.shutdown();
    } catch {
      // shutdown is best-effort cleanup
    }
  }
}

/** Convenience for the common single-boolean case. Fail-closed to `false`. */
export async function checkForgeFlag(
  label: string,
  key: string,
  deps?: ForgeFlagDeps,
): Promise<boolean> {
  return (await evaluateForgeFlags(label, (client) => client.checkFlag(key, false), deps)) ?? false;
}
