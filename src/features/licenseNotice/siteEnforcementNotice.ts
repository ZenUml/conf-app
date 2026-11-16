// Lite per-site paywall enforcement (see the per-site paywall enforcement design).
// The server decides; the client never compares a count or reads the clock.

export type EnforcementStage = 'notice' | 'watermark' | 'block_create' | 'block_edit'
const STAGES: readonly string[] = ['notice', 'watermark', 'block_create', 'block_edit']

export interface SiteEnforcement {
  stage: EnforcementStage
  effectiveAt?: string
  count: number
  limit: number
  effects: { datedBanner: boolean; watermark: boolean; blockCreate: boolean; requestEdit: boolean }
}

export interface SiteEnforcementNotice {
  basis: 'site_policy_limit_reached'
  count: number
  limit: number
  stage: EnforcementStage
}

/** Unknown or malformed input is "enforcement off", never a partial object. */
export function parseSiteEnforcement(value: unknown): SiteEnforcement | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, any>
  const effects = v.effects
  if (!STAGES.includes(v.stage)) return null
  if (!Number.isFinite(v.count) || !Number.isFinite(v.limit)) return null
  if (!effects || typeof effects !== 'object') return null
  return {
    stage: v.stage,
    ...(typeof v.effectiveAt === 'string' ? { effectiveAt: v.effectiveAt } : {}),
    count: v.count,
    limit: v.limit,
    effects: {
      datedBanner: effects.datedBanner === true,
      watermark: effects.watermark === true,
      blockCreate: effects.blockCreate === true,
      // `meterEdit` is what a server that predates the rename sends; accept either name.
      requestEdit: effects.requestEdit === true || effects.meterEdit === true,
    },
  }
}

export function siteEnforcementNotice(input: {
  productType: string | undefined
  enforcement: SiteEnforcement | null | undefined
}): SiteEnforcementNotice | null {
  const e = parseSiteEnforcement(input.enforcement)
  if (input.productType !== 'lite' || !e || e.effects.watermark !== true) return null
  return { basis: 'site_policy_limit_reached', count: e.count, limit: e.limit, stage: e.stage }
}
