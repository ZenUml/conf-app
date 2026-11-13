import { describe, expect, it } from 'vitest'
import { isPageBannerHost } from './pageBannerHost'

describe('isPageBannerHost', () => {
  it.each([
    ['the banner iframe itself', { moduleKey: 'zenuml-page-banner', extension: { type: 'confluence:pageBanner' } }, true],
    ['a default modal object with no macroMode', { moduleKey: 'zenuml-page-banner', extension: { modal: {} } }, true],
    ['an editor modal the banner opened', { moduleKey: 'zenuml-page-banner', extension: { modal: { macroMode: 'editor' } } }, false],
    ['another module', { moduleKey: 'zenuml-byline-diagrams', extension: {} }, false],
    ['no context', undefined, false],
  ])('%s', (_name, context, expected) => {
    expect(isPageBannerHost(context as any)).toBe(expected)
  })
})
