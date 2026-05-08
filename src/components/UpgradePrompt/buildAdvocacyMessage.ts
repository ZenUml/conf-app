export interface AdvocacyMessageContext {
  spaceKey: string
  macroCount: number
  macrosLimit: number
  upgradeUrl: string
  enterpriseBundleUrl: string
  enterpriseBundlePrice: string
}

export const ADVOCACY_TOKEN_KEYS = [
  'SPACE_KEY',
  'MACRO_COUNT',
  'MACROS_LIMIT',
  'UPGRADE_URL',
  'ENTERPRISE_BUNDLE_PRICE',
  'ENTERPRISE_BUNDLE_URL',
] as const

export type AdvocacyTokenKey = typeof ADVOCACY_TOKEN_KEYS[number]

export function buildAdvocacyMessage(ctx: AdvocacyMessageContext): string {
  return `Hey,

I've been using ZenUML to draft sequence diagrams in our "${ctx.spaceKey}" Confluence space, and we've just hit the Lite limit (${ctx.macroCount} of ${ctx.macrosLimit} macros). New edits are blocked until someone with billing access upgrades the space.

Two options when you have a moment:

  • ZenUML Marketplace plan — per-user monthly billing through Atlassian.
    ${ctx.upgradeUrl}
  • Enterprise bundle — ${ctx.enterpriseBundlePrice}, annual flat fee, includes the AI diagramming tools too.
    ${ctx.enterpriseBundleUrl}

Could you take a quick look? Happy to send more details — I'm running into the limit on existing work and would love to keep moving.

Thanks!`
}

export function tokenValueFor(key: AdvocacyTokenKey, ctx: AdvocacyMessageContext): string {
  switch (key) {
    case 'SPACE_KEY':
      return ctx.spaceKey
    case 'MACRO_COUNT':
      return String(ctx.macroCount)
    case 'MACROS_LIMIT':
      return String(ctx.macrosLimit)
    case 'UPGRADE_URL':
      return ctx.upgradeUrl
    case 'ENTERPRISE_BUNDLE_PRICE':
      return ctx.enterpriseBundlePrice
    case 'ENTERPRISE_BUNDLE_URL':
      return ctx.enterpriseBundleUrl
  }
}
