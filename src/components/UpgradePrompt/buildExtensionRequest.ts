import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'
import forgeGlobal from '@/model/globals/forgeGlobal'
import type { MacroKind } from './buildAdvocacyMessage'

export interface ExtensionRequestContext {
  clientDomain: string
  spaceKey: string
  macroCount: number
  macrosLimit: number
  userAccountId: string
  pageId: string
  macroKind: MacroKind
  productType: string
  appVersion: string
  /** Present when the user reached support through the pricing survey. Lets a
   *  support reply be joined to the answers already stored for that response. */
  surveyResponseId?: string
}

// Deep link to the "ZenUML Upgrade or Extension Request" form (request type 9)
// on the ZEN service desk. The portal is open: anonymous customers can view and
// submit with just an email. JSM prefills summary/description/custom fields from
// URL query params, but drops them if the user navigates within the portal
// first — hence linking straight to the create form, not the portal home.
export const DEFAULT_EXTENSION_REQUEST_URL =
  'https://zenuml.atlassian.net/servicedesk/customer/portal/1/group/1/create/9'

// Options of the "Plan you're interested in" field (customfield_10070):
// 10012 = Enterprise Bundle ($299/year per space)
// 10038 = Upgrade via Atlassian Marketplace
// 10037 = Temporary editing extension only (free — no payment)
export const EXTENSION_PLAN_FIELD_ID = 'customfield_10070'
export const EXTENSION_PLAN_OPTION_FREE_EXTENSION = '10037'

export function extensionRequestUrl(): string {
  return import.meta.env.VITE_EXTENSION_REQUEST_URL || DEFAULT_EXTENSION_REQUEST_URL
}

/**
 * Prefilled service-desk URL: instance URL into the "Confluence Instance URL"
 * field (summary), the full structured context into "Space(s) to Upgrade"
 * (description), and the free-extension plan option pre-selected.
 */
export function buildExtensionRequestUrl(ctx: ExtensionRequestContext): string {
  const instanceUrl = ctx.clientDomain.includes('.')
    ? `https://${ctx.clientDomain}`
    : `https://${ctx.clientDomain}.atlassian.net`
  const params = new URLSearchParams({
    summary: instanceUrl,
    description: buildExtensionRequestMessage(ctx),
    [EXTENSION_PLAN_FIELD_ID]: EXTENSION_PLAN_OPTION_FREE_EXTENSION,
  })
  return `${extensionRequestUrl()}?${params.toString()}`
}

export function buildExtensionRequestContext(args: {
  spaceKey: string
  macroCount: number
  macrosLimit: number
  macroKind: MacroKind
  surveyResponseId?: string
}): ExtensionRequestContext {
  return {
    clientDomain: getClientDomain() || 'unknown_atlassian_domain',
    spaceKey: args.spaceKey || 'unknown_space',
    macroCount: args.macroCount,
    macrosLimit: args.macrosLimit,
    userAccountId: forgeGlobal.forgeContext?.accountId || 'unknown_user_account_id',
    pageId: (forgeGlobal.forgeContext?.extension as any)?.content?.id || 'unknown_page_id',
    macroKind: args.macroKind,
    productType: import.meta.env.PRODUCT_TYPE || 'unknown_product_type',
    appVersion: import.meta.env.VITE_APP_VERSION || 'unknown_app_version',
    ...(args.surveyResponseId ? { surveyResponseId: args.surveyResponseId } : {}),
  }
}

export function buildExtensionRequestMessage(ctx: ExtensionRequestContext): string {
  return [
    'Request: Temporary Lite editing extension',
    '',
    `Client domain: ${ctx.clientDomain}`,
    `Space key: ${ctx.spaceKey}`,
    `Macro count: ${ctx.macroCount}`,
    `Limit: ${ctx.macrosLimit}`,
    `Product: ZenUML ${ctx.productType}`,
    `App version: ${ctx.appVersion}`,
    `User account ID: ${ctx.userAccountId}`,
    `Page ID: ${ctx.pageId}`,
    `Macro type: ${ctx.macroKind}`,
    ...(ctx.surveyResponseId ? [`Survey ID: ${ctx.surveyResponseId}`] : []),
    '',
    'Reason:',
    'This Confluence space has reached the ZenUML Lite diagram limit and editing may be disabled. Please temporarily extend editing access while our team reviews upgrade options.',
  ].join('\n')
}
