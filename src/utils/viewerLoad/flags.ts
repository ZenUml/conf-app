/**
 * Kill switch for deferring the viewer's ADF copy-scan — Forge feature flags.
 *
 * Uses the @forge/bridge client-side FeatureFlags SDK (bridge ≥ 5.15):
 * `initialize()` downloads the flag configuration once through the Forge
 * bridge, then `checkFlag()` evaluates locally and synchronously. No Forge
 * Function is invoked (zero GB-seconds) and our Cloudflare backend is not in
 * the path. Targeting (per-site via installContext, percentage rollouts,
 * per-environment) and toggling live in the Developer Console per app
 * (lite / full / diagramly are separate Forge apps — each needs the flag
 * created once).
 *
 * - `viewer-adf-scan-deferred` — defers ApWrapper2.detectCopy (the ADF
 *   copy-scan) off the viewer's critical path; see Task 6's
 *   runDeferredCopyCheck for the completion half.
 *
 * NOT all four variants can use this flag. forgeIndex.ts only builds a
 * `shouldDeferAdfScan` callback when `isSequence` holds, and the asyncapi
 * variant's manifest strips every macro except `zenuml-asyncapi*` /
 * `zenuml-openapi-macro` (scripts/forge-wizard.mjs — the
 * `test("zenuml-asyncapi|zenuml-openapi-macro") | not` delete). None of those
 * satisfy `isSequence`, so on the asyncapi app this module never runs and the
 * flag is inert no matter how the Console shows it. Creating it there is
 * harmless but buys nothing. (Verified 2026-07-19: flag created and enabled
 * for production on the asyncapi app produced zero `adf_deferred` events,
 * while the same change on full flipped live traffic within a minute.)
 *
 * Fail-closed: any init/context error, the standalone (non-Forge) dev
 * environment, and flags that don't exist yet all evaluate to off
 * (`checkFlag` default false). No memoization here — a fresh config read
 * per attempt means Console toggles apply on the next attempt.
 */

import { getContext } from '@/model/globals/forgeGlobal';
import { mapEnvironment } from '@/utils/prefetch/flags';

export const ADF_DEFER_FLAG = 'viewer-adf-scan-deferred';

export interface ViewerLoadFlags {
  adfScanDeferred: boolean;
}

type FeatureFlagEnvironment = 'development' | 'staging' | 'production';

interface FlagClient {
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

async function defaultCreateClient(): Promise<FlagClient> {
  const { FeatureFlags } = await import('@forge/bridge');
  return new FeatureFlags();
}

export async function getViewerLoadFlags(deps?: {
  createClient?: () => Promise<FlagClient>;
  getForgeContext?: () => Promise<{ cloudId?: string; accountId?: string; environmentType?: string } | undefined>;
}): Promise<ViewerLoadFlags> {
  const off: ViewerLoadFlags = { adfScanDeferred: false };
  let client: FlagClient | undefined;
  try {
    const context = await (deps?.getForgeContext ?? getContext)();
    const cloudId = context?.cloudId;
    if (!cloudId) {
      // Diagnosable fail-closed: without a cloudId there is no install to
      // target (standalone dev, or an unexpected context shape). NOTE: the
      // Custom UI context has NO `installContext` field (that's the resolver
      // context) — per the client-SDK docs the install ARI is constructed
      // from cloudId and passed as an ATTRIBUTE, with accountId as the
      // bucketing identifier (verified live on lite-dev, 2026-06-10).
      console.debug('[viewer-load] flags off: no cloudId in context', Object.keys(context ?? {}));
      return off;
    }

    client = await (deps?.createClient ?? defaultCreateClient)();
    await client.initialize(
      {
        attributes: { installContext: `ari:cloud:confluence::site/${cloudId}` },
        identifiers: { accountId: context?.accountId },
      },
      { environment: mapEnvironment(context?.environmentType) },
    );
    const result = { adfScanDeferred: client.checkFlag(ADF_DEFER_FLAG, false) };
    console.debug('[viewer-load] flags', mapEnvironment(context?.environmentType), result);
    return result;
  } catch (e) {
    console.debug('[viewer-load] flags off: evaluation failed', e);
    return off;
  } finally {
    try {
      client?.shutdown();
    } catch {
      // shutdown is best-effort cleanup
    }
  }
}
