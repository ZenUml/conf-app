import { describe, it, expect } from 'vitest'
import {
  buildExtensionRequestUrl,
  buildExtensionRequestMessage,
  DEFAULT_EXTENSION_REQUEST_URL,
  EXTENSION_PLAN_FIELD_ID,
  EXTENSION_PLAN_OPTION_FREE_EXTENSION,
  type ExtensionRequestContext,
} from './buildExtensionRequest'

const ctx: ExtensionRequestContext = {
  clientDomain: 'example-tenant',
  spaceKey: 'ENG',
  macroCount: 163,
  macrosLimit: 100,
  userAccountId: 'abc:123',
  pageId: '456',
  macroKind: 'sequence',
  productType: 'lite',
  appVersion: '1.2.3',
}

describe('buildExtensionRequestUrl', () => {
  it('deep-links to the upgrade/extension request form, not the portal home', () => {
    const url = new URL(buildExtensionRequestUrl(ctx))
    expect(`${url.origin}${url.pathname}`).toBe(DEFAULT_EXTENSION_REQUEST_URL)
  })

  it('prefills the instance URL into the summary field', () => {
    const url = new URL(buildExtensionRequestUrl(ctx))
    expect(url.searchParams.get('summary')).toBe('https://example-tenant.atlassian.net')
  })

  it('keeps an already-qualified hostname as-is', () => {
    const url = new URL(
      buildExtensionRequestUrl({ ...ctx, clientDomain: 'example-tenant.atlassian.net' })
    )
    expect(url.searchParams.get('summary')).toBe('https://example-tenant.atlassian.net')
  })

  it('prefills the full structured context into the description field', () => {
    const url = new URL(buildExtensionRequestUrl(ctx))
    const description = url.searchParams.get('description')
    expect(description).toBe(buildExtensionRequestMessage(ctx))
    expect(description).toContain('Space key: ENG')
    expect(description).toContain('Macro count: 163')
  })

  it('pre-selects the free extension plan option', () => {
    const url = new URL(buildExtensionRequestUrl(ctx))
    expect(url.searchParams.get(EXTENSION_PLAN_FIELD_ID)).toBe(
      EXTENSION_PLAN_OPTION_FREE_EXTENSION
    )
  })
})
