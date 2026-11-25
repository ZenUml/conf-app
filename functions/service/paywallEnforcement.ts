import { cachedSpaceCount, resolveSiteDomain, RECOVERY_SPACE_KEY } from './fullscreenRecoveryEligibility';
import { LITE_FORGE_APP_ID } from './fullscreenRecoveryService';

// The published Lite limit; mirrors MACROS_LIMIT in src/composables/useCustomerSuccessService.ts.
// Shown to the reader, never compared with a count here.
export const ENFORCEMENT_MACROS_LIMIT = 100;
// Enforcement starts above the published limit, so a miscount near 100 cannot trigger it.
export const ENFORCEMENT_THRESHOLD = 150;

export type EnforcementStage = 'notice' | 'watermark' | 'block_create' | 'block_edit';
export type Tri = 'yes' | 'no' | 'unknown';

/** The three switches a site policy sets. Each is independent; none implies another. */
export type PolicyEffects = { watermark: boolean; blockCreate: boolean; requestEdit: boolean };
/**
 * `stage` is a label derived from `effects` (the highest switch that is on). Deployed clients
 * read it only for analytics and require it to be one of the four names.
 */
export interface EnforcementPolicy { stage: EnforcementStage; effects: PolicyEffects; effectiveAt: string }
export interface EnforcementEffects {
  datedBanner: boolean; watermark: boolean; blockCreate: boolean;
  /** At `block_edit` an existing diagram opens behind the edit request gate. */
  requestEdit: boolean;
  /** Old name of `requestEdit`, emitted until every deployed client reads the new one. */
  meterEdit: boolean;
}
export interface SpaceEnforcement {
  stage: EnforcementStage; effectiveAt: string; count: number; limit: number; effects: EnforcementEffects;
}

const STAGES: readonly EnforcementStage[] = ['notice', 'watermark', 'block_create', 'block_edit'];

const POLICY_SWITCHES = ['watermark', 'blockCreate', 'requestEdit'] as const;
const NO_EFFECTS: PolicyEffects = { watermark: false, blockCreate: false, requestEdit: false };

/** The legacy cumulative ladder: `{ "stage": ... }` keys written before independent switches. */
function ladderEffects(stage: EnforcementStage): PolicyEffects {
  const rank = STAGES.indexOf(stage);
  return { watermark: rank >= 1, blockCreate: rank >= 2, requestEdit: rank >= 3 };
}

function stageLabel(effects: PolicyEffects): EnforcementStage {
  return effects.requestEdit ? 'block_edit' : effects.blockCreate ? 'block_create' : effects.watermark ? 'watermark' : 'notice';
}

/**
 * Two shapes. `{ "effects": { "watermark"?, "blockCreate"?, "requestEdit"? }, "effectiveAt" }`
 * sets each switch on its own; an absent switch is off. `{ "stage", "effectiveAt" }` is the
 * legacy ladder. Anything else, including both shapes at once or a non-boolean switch, is no policy.
 */
export function parseEnforcementPolicy(raw: string | null): EnforcementPolicy | null {
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { stage, effects, effectiveAt } = value as Record<string, unknown>;
  if (typeof effectiveAt !== 'string' || !Number.isFinite(Date.parse(effectiveAt))) return null;
  if (effects !== undefined) {
    if (stage !== undefined || !effects || typeof effects !== 'object' || Array.isArray(effects)) return null;
    const given = effects as Record<string, unknown>;
    if (Object.keys(given).some(key => !(POLICY_SWITCHES as readonly string[]).includes(key))) return null;
    if (Object.values(given).some(v => typeof v !== 'boolean')) return null;
    const parsed = { ...NO_EFFECTS, ...(given as Partial<PolicyEffects>) };
    return { stage: stageLabel(parsed), effects: parsed, effectiveAt };
  }
  if (typeof stage !== 'string' || !STAGES.includes(stage as EnforcementStage)) return null;
  return { stage: stage as EnforcementStage, effects: ladderEffects(stage as EnforcementStage), effectiveAt };
}

/** Before `effectiveAt` every stage behaves as `notice`; the boundary instant is in force. */
export function stageInForce(policy: EnforcementPolicy | null, now: Date): EnforcementStage | null {
  if (!policy) return null;
  if (policy.stage === 'notice') return 'notice';
  return now.getTime() >= Date.parse(policy.effectiveAt) ? policy.stage : 'notice';
}

/** The only place a space count decides enforcement. */
export function thresholdReached(count: unknown): Tri {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return 'unknown';
  return count >= ENFORCEMENT_THRESHOLD ? 'yes' : 'no';
}

export function decideEnforcement(
  input: { stage: EnforcementStage | null; limit: Tri; covered: Tri },
): EnforcementStage | 'off' {
  return input.stage !== null && input.limit === 'yes' && input.covered === 'no' ? input.stage : 'off';
}

/** Before `effectiveAt` every switch is off: the dated banner alone (`notice`). */
export function effectsInForce(policy: EnforcementPolicy, now: Date): PolicyEffects {
  return stageInForce(policy, now) === 'notice' ? NO_EFFECTS : policy.effects;
}

export function effectsOf(effects: PolicyEffects): EnforcementEffects {
  return { datedBanner: true, ...effects, meterEdit: effects.requestEdit };
}

export interface EnforcementEnv {
  DB?: D1Database;
  KV_FEATURE_FLAGS?: KVNamespace;
  confluence_plugin_features?: KVNamespace;
}

/** Covered by an operational exemption: `"*"` or the site's own domain. */
function exemptionCover(raw: string | null, domain: string): Tri {
  if (!raw) return 'unknown';
  try {
    const list: unknown = JSON.parse(raw);
    if (!list || typeof list !== 'object' || Array.isArray(list)
      || Object.values(list).some(v => typeof v !== 'boolean')) return 'unknown';
    const flags = list as Record<string, boolean>;
    return flags['*'] === true || flags[domain] === true ? 'yes' : 'no';
  } catch { return 'unknown'; }
}

/**
 * Called only after the caller has confirmed the space is not covered by a licence or the
 * paid rail. Reads the site policy first; a site without one costs a single KV read.
 * Fails open: any missing binding or error returns null.
 */
export async function resolveEnforcement(
  env: EnforcementEnv,
  input: { cloudId: string; forgeAppId?: string; spaceKey: string },
  now = new Date(),
): Promise<SpaceEnforcement | null> {
  try {
    if (!env.KV_FEATURE_FLAGS) return null;
    const policy = parseEnforcementPolicy(
      await env.KV_FEATURE_FLAGS.get(`paywall-enforcement:policy:${input.cloudId}`));
    const stage = stageInForce(policy, now);
    if (!policy || !stage) return null;
    if (input.forgeAppId !== LITE_FORGE_APP_ID) return null;
    if (!env.DB || !env.confluence_plugin_features || !RECOVERY_SPACE_KEY.test(input.spaceKey)) return null;

    const domain = await resolveSiteDomain(env.DB, { cloudId: input.cloudId, forgeAppId: input.forgeAppId });
    if (!domain) return null;
    const count = await cachedSpaceCount(env.confluence_plugin_features, domain, input.spaceKey);
    const limit = thresholdReached(count);
    if (limit !== 'yes') return null;

    const covered = exemptionCover(await env.KV_FEATURE_FLAGS.get('PAYWALL_EXEMPTIONS'), domain);
    if (decideEnforcement({ stage, limit, covered }) === 'off') return null;
    return {
      stage, effectiveAt: policy.effectiveAt, count: count as number,
      limit: ENFORCEMENT_MACROS_LIMIT, effects: effectsOf(effectsInForce(policy, now)),
    };
  } catch (error) {
    console.error('paywall-enforcement: resolve failed', error);
    return null;
  }
}
