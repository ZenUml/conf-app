/**
 * Mixpanel session-replay BASELINE sampling — controlled live from the Forge
 * Developer Console rather than hardcoded in this module.
 *
 * The typed analytics path has one deliberate override: every
 * macro_create_started / macro_edit_started event forces recording at 100%.
 * That authoring policy does not use a Forge flag; these flags continue to
 * control viewer and other non-authoring iframe sessions.
 *
 * Uses the @forge/bridge client-side FeatureFlags SDK (bridge ≥ 5.15):
 * `initialize()` downloads the flag configuration once through the Forge
 * bridge, then `checkFlag()` evaluates locally and synchronously. No Forge
 * Function is invoked (zero GB-seconds) and our Cloudflare backend is not in
 * the path. Targeting (per-site via installContext) and percentage rollouts
 * live in the Developer Console per app (lite / full / diagramly are separate
 * Forge apps — each needs both flags created once).
 *
 * Two boolean flags, resolved by precedence into `record_sessions_percent`:
 *
 * - `session-replay-full` — TARGETED. Add a customer's install to this flag's
 *   targeting rule to capture 100% of their sessions for a full inspection;
 *   remove it when done. This is what per-user bucketing is good at: complete,
 *   end-to-end journeys of one tenant.
 * - `session-replay`      — GENERAL. Its ROLLOUT PERCENTAGE is the live global
 *   sampling rate: the bucketed cohort records at 100%, so dragging the rollout
 *   slider from 2% → 0.5% → 0 in the console IS the rate dial. No deploy, no
 *   constant in code.
 *
 * `session-replay-full` is checked first, so a targeted inspection keeps
 * recording even while the general rate is dialed down. (The two flags are
 * independent: a boolean flag cannot tell "0% rollout" apart from "not in the
 * cohort", so dragging `session-replay` to 0 does NOT auto-stop a targeted
 * inspection — disable `session-replay-full` in the same console visit to also
 * halt it. The only fully-automatic version needs a third master flag.)
 *
 * Fail-closed: any init/context error, the standalone (non-Forge) dev
 * environment, and flags that don't exist yet all evaluate to 0% (`checkFlag`
 * default false). No memoization here — the caller (`_initMixpanel`) is invoked
 * once per iframe load, so this is already a rare call, and a fresh config read
 * means Console changes apply on the next iframe mount.
 */

import { getContext } from '@/model/globals/forgeGlobal';

export const FULL_FLAG = 'session-replay-full';
export const SAMPLED_FLAG = 'session-replay';

export type SessionReplaySource = 'targeted' | 'sampled' | 'off';

export interface SessionReplayConfig {
  /** `record_sessions_percent` to pass to `mixpanel.init`. */
  percent: number;
  /** Why we landed on `percent` — registered as a Mixpanel super-property. */
  source: SessionReplaySource;
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

const OFF: SessionReplayConfig = { percent: 0, source: 'off' };

export async function getSessionReplayConfig(deps?: {
  createClient?: () => Promise<FlagClient>;
  getForgeContext?: () => Promise<{ cloudId?: string; accountId?: string; environmentType?: string } | undefined>;
}): Promise<SessionReplayConfig> {
  let client: FlagClient | undefined;
  try {
    const context = await (deps?.getForgeContext ?? getContext)();
    const cloudId = context?.cloudId;
    if (!cloudId) {
      // Fail-closed: without a cloudId there is no install to target
      // (standalone dev, or an unexpected context shape). The Custom UI context
      // has NO `installContext` field — the install ARI is constructed from
      // cloudId and passed as an ATTRIBUTE, with accountId as the bucketing
      // identifier (verified live on lite-dev, 2026-06-10).
      return OFF;
    }

    client = await (deps?.createClient ?? defaultCreateClient)();
    await client.initialize(
      {
        attributes: { installContext: `ari:cloud:confluence::site/${cloudId}` },
        identifiers: { accountId: context?.accountId },
      },
      { environment: mapEnvironment(context?.environmentType) },
    );

    // Targeted inspection wins over the general rate, so a full capture keeps
    // running even while `session-replay` is dialed down.
    if (client.checkFlag(FULL_FLAG, false)) {
      return { percent: 100, source: 'targeted' };
    }
    if (client.checkFlag(SAMPLED_FLAG, false)) {
      // In the rollout cohort: record this user's sessions at 100%. The cohort
      // SIZE (the rollout %) is the live rate, set in the console.
      return { percent: 100, source: 'sampled' };
    }
    return OFF;
  } catch (e) {
    console.debug('[session-replay] off: evaluation failed', e);
    return OFF;
  } finally {
    try {
      client?.shutdown();
    } catch {
      // shutdown is best-effort cleanup
    }
  }
}
