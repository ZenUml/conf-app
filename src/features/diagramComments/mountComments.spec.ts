import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMENTS_MACRO_MODE, isCommentsModalContext, mountCommentsModal } from './mountComments'

vi.mock('@/model/globals/forgeGlobal', () => ({ getView: vi.fn() }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/utils/byline/confluenceRequest', () => ({ requestConfluenceJson: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) })) }))

const commentsContext = {
  pageId: '42', pageUrl: 'https://example.atlassian.net/wiki/spaces/OP/pages/42/Checkout', localId: 'loc-1',
  diagramId: 'cc-1', diagramVersion: 4, diagramTitle: 'Checkout', lastModifierId: 'acc-9',
  currentAccountId: 'acc-1', macroType: 'mermaid',
}
const ctx = (modal: Record<string, unknown>) => ({ extension: { modal: { macroMode: COMMENTS_MACRO_MODE, commentsContext, ...modal } } })

describe('mountCommentsModal', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="app"></div>' })
  afterEach(() => { document.body.innerHTML = '' })

  it('recognises only the comments macro mode', () => {
    expect(isCommentsModalContext(ctx({}))).toBe(true)
    expect(isCommentsModalContext({ extension: { modal: { macroMode: 'feedback' } } })).toBe(false)
    expect(isCommentsModalContext({ extension: {} })).toBe(false)
  })

  it('mounts the panel full size with the context the viewer handed over', () => {
    expect(mountCommentsModal(ctx({}))).toBe(true)
    const panel = document.querySelector('[data-testid="diagram-comments-panel"]')
    expect(panel).not.toBeNull()
    // The Forge modal owns the close control.
    expect(document.querySelector('[data-testid="diagram-comments-close"]')).toBeNull()
  })

  it('refuses a context with missing or empty fields instead of mounting a broken panel', () => {
    expect(mountCommentsModal(ctx({ commentsContext: { ...commentsContext, diagramId: '' } }))).toBe(false)
    expect(mountCommentsModal(ctx({ commentsContext: { ...commentsContext, pageId: undefined } }))).toBe(false)
    expect(mountCommentsModal(ctx({ commentsContext: undefined }))).toBe(false)
    expect(document.querySelector('[data-testid="diagram-comments-panel"]')).toBeNull()
  })
})
