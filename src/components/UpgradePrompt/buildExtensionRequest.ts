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
}

export const DEFAULT_EXTENSION_REQUEST_URL = 'https://zenuml.atlassian.net/servicedesk/customer/portals'

export function extensionRequestUrl(): string {
  return import.meta.env.VITE_EXTENSION_REQUEST_URL || DEFAULT_EXTENSION_REQUEST_URL
}

export function buildExtensionRequestContext(args: {
  spaceKey: string
  macroCount: number
  macrosLimit: number
  macroKind: MacroKind
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
    '',
    'Reason:',
    'This Confluence space has reached the ZenUML Lite diagram limit and editing may be disabled. Please temporarily extend editing access while our team reviews upgrade options.',
  ].join('\n')
}
