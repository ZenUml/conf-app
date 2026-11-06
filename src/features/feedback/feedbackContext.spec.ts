import { describe, expect, it } from 'vitest'
import { deriveFeedbackContext, feedbackSurfaceForContext } from './feedbackContext'

describe('feedback surface routing', () => {
  it('supports product work surfaces including PNG Export and excludes byline and banners', () => {
    expect(feedbackSurfaceForContext({ extension: { type: 'confluence:macro' }, moduleKey: 'zenuml-sequence-macro-lite' })).toBe('viewer')
    expect(feedbackSurfaceForContext({ extension: { modal: { macroMode: 'editor' } }, moduleKey: 'zenuml-sequence-macro-lite' })).toBe('editor')
    expect(feedbackSurfaceForContext({ extension: { modal: { macroMode: 'fullscreen' } }, moduleKey: 'zenuml-sequence-macro-lite' })).toBe('fullscreen')
    expect(feedbackSurfaceForContext({ extension: { type: 'confluence:globalSettings' }, moduleKey: 'zenuml-get-started' })).toBe('get_started')
    expect(feedbackSurfaceForContext({ extension: { type: 'confluence:globalPage' }, moduleKey: 'zenuml-dashboard-page' })).toBe('dashboard')
    expect(feedbackSurfaceForContext({ feedbackSurface: 'png_export', extension: { type: 'confluence:macro' }, moduleKey: 'zenuml-mermaid-macro-lite' })).toBe('png_export')
    expect(feedbackSurfaceForContext({ extension: { type: 'confluence:contentBylineItem' }, moduleKey: 'zenuml-byline-diagrams' })).toBeNull()
    expect(feedbackSurfaceForContext({ extension: { type: 'confluence:pageBanner' }, moduleKey: 'zenuml-page-banner' })).toBeNull()
    expect(feedbackSurfaceForContext({ extension: { modal: { macroMode: 'feedback' } }, moduleKey: 'zenuml-sequence-macro-lite' })).toBeNull()
  })

  it('derives all eight report fields and uses explicit unavailable values', () => {
    expect(deriveFeedbackContext({
      accountId: 'account-example',
      siteUrl: 'https://example-tenant.atlassian.net',
      moduleKey: 'zenuml-sequence-macro-lite',
      localId: 'macro-example',
      extension: { type: 'confluence:macro', space: { name: 'Example space' }, content: { id: 'content-example' } },
    }, { id: 'custom-content-example', diagramType: 'mermaid', title: 'Checkout flow' })).toEqual({
      surface: 'viewer',
      hostModule: 'zenuml-sequence-macro-lite',
      diagramType: 'mermaid',
      diagramTitle: 'Checkout flow',
      userAccountId: 'account-example',
      clientDomain: 'example-tenant',
      spaceName: 'Example space',
      macroUuid: 'macro-example',
      contentId: 'content-example',
      customContentId: 'custom-content-example',
    })

    const global = deriveFeedbackContext({
      accountId: 'account-example',
      siteUrl: 'https://example-tenant.atlassian.net',
      moduleKey: 'zenuml-dashboard-page',
      extension: { type: 'confluence:globalPage' },
    })
    expect(global).toMatchObject({
      surface: 'dashboard',
      diagramType: 'not_applicable',
      diagramTitle: 'not_applicable',
      spaceName: 'not_applicable',
      macroUuid: 'not_applicable',
      contentId: 'not_applicable',
      customContentId: 'not_applicable',
    })
  })

  it('falls back to a human-readable Untitled diagram for a missing title on diagram-bearing surfaces, and never for global surfaces', () => {
    const viewerContext = {
      accountId: 'account-example',
      siteUrl: 'https://example-tenant.atlassian.net',
      moduleKey: 'zenuml-sequence-macro-lite',
      localId: 'macro-example',
      extension: { type: 'confluence:macro', space: { name: 'Example space' }, content: { id: 'content-example' } },
    }

    expect(deriveFeedbackContext(viewerContext, { id: 'custom-content-example', diagramType: 'mermaid', title: '' }).diagramTitle)
      .toBe('Untitled diagram')

    expect(deriveFeedbackContext(viewerContext, { id: 'custom-content-example', diagramType: 'mermaid', title: '   ' }).diagramTitle)
      .toBe('Untitled diagram')

    expect(deriveFeedbackContext(viewerContext, { id: 'custom-content-example', diagramType: 'mermaid', title: 'Checkout flow' }).diagramTitle)
      .toBe('Checkout flow')

    const global = deriveFeedbackContext({
      accountId: 'account-example',
      siteUrl: 'https://example-tenant.atlassian.net',
      moduleKey: 'zenuml-dashboard-page',
      extension: { type: 'confluence:globalPage' },
    })
    expect(global.diagramTitle).toBe('not_applicable')
  })
})
