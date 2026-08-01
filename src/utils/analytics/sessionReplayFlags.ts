/**
 * Mixpanel session-replay sampling — controlled live from the Forge Developer
 * Console, never hardcoded in this repo. Keys live in
 * utils/featureFlags/registry.ts; evaluation goes through the shared
 * utils/featureFlags/forgeFlagClient.ts one-shot evaluator (client-side
 * @forge/bridge SDK — no Forge Function invoked, zero GB-seconds, Cloudflare
 * not in the path). Targeting and percentage rollouts live in the Developer
 * Console per app (lite / full / diagramly are separate Forge apps — each
 * needs both flags created once).
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

import { FORGE_FLAGS } from '@/utils/featureFlags/registry';
import { evaluateForgeFlags, type ForgeFlagDeps } from '@/utils/featureFlags/forgeFlagClient';

export const FULL_FLAG = FORGE_FLAGS.sessionReplayFull;
export const SAMPLED_FLAG = FORGE_FLAGS.sessionReplay;

// Re-exported for existing importers/specs; canonical home is
// utils/forgeFlagEnvironment.ts.
export { mapEnvironment } from '@/utils/forgeFlagEnvironment';

export type SessionReplaySource = 'targeted' | 'sampled' | 'off';

export interface SessionReplayConfig {
  /** `record_sessions_percent` to pass to `mixpanel.init`. */
  percent: number;
  /** Why we landed on `percent` — registered as a Mixpanel super-property. */
  source: SessionReplaySource;
}

const OFF: SessionReplayConfig = { percent: 0, source: 'off' };

export async function getSessionReplayConfig(deps?: ForgeFlagDeps): Promise<SessionReplayConfig> {
  const config = await evaluateForgeFlags<SessionReplayConfig>(
    '[session-replay]',
    (client) => {
      // Targeted inspection wins over the general rate, so a full capture keeps
      // running even while `session-replay` is dialed down.
      if (client.checkFlag(FULL_FLAG, false)) {
        console.debug('[session-replay] targeted full capture');
        return { percent: 100, source: 'targeted' };
      }
      if (client.checkFlag(SAMPLED_FLAG, false)) {
        // In the rollout cohort: record this user's sessions at 100%. The cohort
        // SIZE (the rollout %) is the live rate, set in the console.
        console.debug('[session-replay] in general rollout cohort');
        return { percent: 100, source: 'sampled' };
      }
      return OFF;
    },
    deps,
  );
  return config ?? OFF;
}
