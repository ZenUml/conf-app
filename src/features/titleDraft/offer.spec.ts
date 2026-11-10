import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const APP = '11111111-1111-4111-8111-111111111111'
const ENV = '22222222-2222-4222-8222-222222222222'

const m = vi.hoisted(() => ({
  showFlag: vi.fn(),
  openModal: vi.fn(),
  isTitleDraftEnabled: vi.fn(),
  viewerAccountKind: vi.fn(),
  requestConfluenceJson: vi.fn(),
  callRemote: vi.fn(),
  canEditPage: vi.fn(),
  readTitleDraftRecord: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
  reloadHostPage: vi.fn(),
  forge: { forgeContext: {} as any },
}))

vi.mock('@forge/bridge', () => ({ showFlag: m.showFlag }))
vi.mock('@/model/globals/forgeGlobal', () => ({ default: m.forge, openModal: m.openModal }))
vi.mock('@/model/globals', () => ({ default: { apWrapper: { initializeContext: vi.fn(async () => {}) } } }))
vi.mock('@/apis/aiTitleFeatureFlag', () => ({ isTitleDraftEnabled: m.isTitleDraftEnabled }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: m.trackAnalyticsEvent }))
vi.mock('@/utils/byline/addToPage', async (orig) => ({
  ...(await orig<typeof import('@/utils/byline/addToPage')>()),
  reloadHostPage: m.reloadHostPage,
}))
vi.mock('@/utils/byline/confluenceRequest', () => ({ requestConfluenceJson: m.requestConfluenceJson }))
vi.mock('@/utils/magic/viewerAccount', () => ({ viewerAccountKind: m.viewerAccountKind }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({ getClientDomain: () => 'example-tenant' }))
vi.mock('@/utils/requestUtil', () => ({ callRemote: m.callRemote }))
vi.mock('./canEdit', () => ({ canEditPage: m.canEditPage }))
vi.mock('./pageState', () => ({ readTitleDraftRecord: m.readTitleDraftRecord }))

import { maybeOfferTitleDraft } from './offer'
import { markNotNow } from './localState'

const IDENTITY = { clientDomain: 'example-tenant', accountId: 'acc-1' }
const TITLE = 'Order approval workflow'
const MERMAID = 'sequenceDiagram\n  Buyer->>Manager: Request approval'

const adf = (content: unknown[] = [{ type: 'paragraph' }]) => JSON.stringify({ type: 'doc', content })
const ownMacro = { type: 'extension', attrs: { extensionKey: `${APP}/${ENV}/static/zenuml-sequence-macro-lite` } }

function setPage(pageId: string) {
  m.forge.forgeContext = {
    accountId: 'acc-1',
    localId: `ari-cloud-ecosystem--extension-${APP}-${ENV}-static-zenuml-banner`,
    environmentId: ENV,
    extension: { content: { id: pageId, type: 'page' } },
  }
}

const flags = () => m.showFlag.mock.calls.map(c => c[0])
const actionOf = (flag: any, text: string) => flag.actions.find((a: any) => a.text === text)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.useRealTimers()
  setPage('100')
  m.isTitleDraftEnabled.mockResolvedValue(true)
  m.viewerAccountKind.mockResolvedValue('licensed')
  m.requestConfluenceJson.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (url.includes('/spaces/') ? { name: 'Sales' } : { title: TITLE, spaceId: 's1', body: { atlas_doc_format: { value: adf() } } }),
  }))
  m.readTitleDraftRecord.mockResolvedValue(null)
  m.canEditPage.mockResolvedValue(true)
  m.callRemote.mockResolvedValue({ status: 'ready', mermaid: MERMAID, kind: 'sequence', confidence: 0.9 })
  m.showFlag.mockImplementation(() => ({ close: vi.fn() }))
  m.openModal.mockResolvedValue(undefined)
  m.reloadHostPage.mockResolvedValue(true)
})

afterEach(() => vi.useRealTimers())

describe('maybeOfferTitleDraft gates', () => {
  const cases: Array<{ name: string; product?: string; arrange?: () => void; expectFlagLookup?: boolean }> = [
    { name: 'non-Lite product', product: 'full', expectFlagLookup: false },
    { name: 'flag off', arrange: () => m.isTitleDraftEnabled.mockResolvedValue(false) },
    { name: 'guest viewer', arrange: () => m.viewerAccountKind.mockResolvedValue('guest') },
    { name: 'anonymous viewer', arrange: () => m.viewerAccountKind.mockResolvedValue('anonymous') },
    { name: 'unknown viewer', arrange: () => m.viewerAccountKind.mockResolvedValue('unknown') },
    { name: 'Not now on this page', arrange: () => markNotNow(IDENTITY, '100') },
    {
      name: 'page already has this app macro',
      arrange: () => m.requestConfluenceJson.mockImplementation(async () => ({
        ok: true,
        json: async () => ({ title: TITLE, body: { atlas_doc_format: { value: adf([ownMacro]) } } }),
      })),
    },
    { name: 'title-draft record present', arrange: () => m.readTitleDraftRecord.mockResolvedValue({ contentId: 'c9' }) },
    { name: 'title-draft read unknown', arrange: () => m.readTitleDraftRecord.mockResolvedValue({ unknown: true }) },
    { name: 'cannot edit', arrange: () => m.canEditPage.mockResolvedValue(false) },
  ]

  it.each(cases)('$name: no offer, no backend call', async ({ product, arrange, expectFlagLookup }) => {
    arrange?.()
    expect(await maybeOfferTitleDraft(product ?? 'lite')).toBe(false)
    expect(m.showFlag).not.toHaveBeenCalled()
    expect(m.callRemote).not.toHaveBeenCalled()
    if (expectFlagLookup === false) expect(m.isTitleDraftEnabled).not.toHaveBeenCalled()
  })

  it('Not now on this page makes no Confluence read', async () => {
    markNotNow(IDENTITY, '100')
    await maybeOfferTitleDraft('lite')
    expect(m.requestConfluenceJson).not.toHaveBeenCalled()
  })

  it('status pending: the backend is asked again after 1 hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-11-08T00:00:00Z'))
    m.callRemote.mockResolvedValue({ status: 'pending' })
    await maybeOfferTitleDraft('lite')
    vi.setSystemTime(Date.parse('2026-11-08T00:59:00Z'))
    await maybeOfferTitleDraft('lite')
    expect(m.callRemote).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.parse('2026-11-08T01:00:00Z'))
    await maybeOfferTitleDraft('lite')
    expect(m.callRemote).toHaveBeenCalledTimes(2)
  })

  it('status no_diagram: still skipped 1 hour later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-11-08T00:00:00Z'))
    m.callRemote.mockResolvedValue({ status: 'no_diagram' })
    await maybeOfferTitleDraft('lite')
    vi.setSystemTime(Date.parse('2026-11-08T01:00:00Z'))
    await maybeOfferTitleDraft('lite')
    expect(m.callRemote).toHaveBeenCalledTimes(1)
  })

  it.each(['pending', 'no_diagram'])('status %s: no flag, and a second call the same day skips the backend', async (status) => {
    m.callRemote.mockResolvedValue({ status })
    expect(await maybeOfferTitleDraft('lite')).toBe(false)
    expect(m.callRemote).toHaveBeenCalledTimes(1)
    expect(m.showFlag).not.toHaveBeenCalled()
    expect(await maybeOfferTitleDraft('lite')).toBe(false)
    expect(m.callRemote).toHaveBeenCalledTimes(1)
    expect(m.showFlag).not.toHaveBeenCalled()
  })

  it('status ready shows the entry flag, then the 24 h cap hides it on a second page', async () => {
    expect(await maybeOfferTitleDraft('lite')).toBe(true)
    expect(m.callRemote).toHaveBeenCalledTimes(1)
    expect(m.callRemote.mock.calls[0][2]).toMatchObject({ pageId: '100', title: TITLE, spaceName: 'Sales' })
    const [flag] = flags()
    expect(flag).toMatchObject({ title: 'A diagram for this page is ready', isAutoDismiss: false })
    expect(flag.actions.map((a: any) => a.text)).toEqual(['See diagram', 'Not now'])

    setPage('200')
    expect(await maybeOfferTitleDraft('lite')).toBe(false)
    expect(m.showFlag).toHaveBeenCalledTimes(1)
    expect(m.callRemote).toHaveBeenCalledTimes(1)
  })
})

describe('maybeOfferTitleDraft actions', () => {
  it('Not now is recorded per person and page, and explained only the first time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-11-08T00:00:00Z'))
    await maybeOfferTitleDraft('lite')
    actionOf(flags()[0], 'Not now').onClick()
    await vi.waitFor(() => expect(m.showFlag).toHaveBeenCalledTimes(2))
    expect(flags()[1]).toMatchObject({
      title: 'No more diagram suggestions on this page',
      description: 'To add one later, open Diagrams Lite under the page title.',
      isAutoDismiss: true,
    })

    // Same page stays quiet.
    m.callRemote.mockClear()
    expect(await maybeOfferTitleDraft('lite')).toBe(false)
    expect(m.callRemote).not.toHaveBeenCalled()

    // A day later, on another page, a second Not now adds no explanation.
    vi.setSystemTime(Date.parse('2026-11-09T01:00:00Z'))
    setPage('200')
    expect(await maybeOfferTitleDraft('lite')).toBe(true)
    expect(m.showFlag).toHaveBeenCalledTimes(3)
    actionOf(flags()[2], 'Not now').onClick()
    await new Promise(r => setTimeout(r, 0))
    expect(m.showFlag).toHaveBeenCalledTimes(3)
  })

  it('See diagram opens an xlarge modal titled for the page', async () => {
    await maybeOfferTitleDraft('lite')
    actionOf(flags()[0], 'See diagram').onClick()
    await vi.waitFor(() => expect(m.openModal).toHaveBeenCalledTimes(1))
    expect(m.openModal.mock.calls[0][0]).toMatchObject({
      size: 'xlarge',
      title: `Diagram for ${TITLE}`,
      context: { pageId: '100', pageTitle: TITLE, mermaid: MERMAID },
    })
  })

  async function openAndClose(payload: unknown) {
    await maybeOfferTitleDraft('lite')
    actionOf(flags()[0], 'See diagram').onClick()
    await vi.waitFor(() => expect(m.openModal).toHaveBeenCalled())
    m.openModal.mock.calls[0][0].onClose(payload)
  }

  it('closing with added reloads the host, and the next view shows the added flag', async () => {
    await openAndClose({ outcome: 'added', contentId: 'c1' })
    expect(m.reloadHostPage).toHaveBeenCalledTimes(1)

    expect(await maybeOfferTitleDraft('lite')).toBe(true)
    const added = flags().at(-1)
    expect(added).toMatchObject({ title: 'Added to the top of the page', isAutoDismiss: false })
    expect(added.actions.map((a: any) => a.text)).toEqual(['Edit diagram', 'Undo'])
    expect(m.callRemote).toHaveBeenCalledTimes(1)
  })

  it('Edit diagram opens the editor on the added diagram and reloads the page when it closes', async () => {
    await openAndClose({ outcome: 'added', contentId: 'cc-1' })
    await vi.waitFor(() => expect(m.reloadHostPage).toHaveBeenCalled())
    m.reloadHostPage.mockClear()
    m.openModal.mockClear()
    m.showFlag.mockClear()

    await maybeOfferTitleDraft('lite')
    actionOf(flags()[0], 'Edit diagram').onClick()
    await vi.waitFor(() => expect(m.openModal).toHaveBeenCalledTimes(1))
    const modal = m.openModal.mock.calls[0][0]
    expect(modal).toMatchObject({
      size: 'fullscreen',
      context: { macroMode: 'editor', customContentId: 'cc-1' },
    })

    modal.onClose()
    expect(m.reloadHostPage).toHaveBeenCalledTimes(1)
  })

  it('closing with already_added shows the already-added flag', async () => {
    await openAndClose({ outcome: 'already_added' })
    await vi.waitFor(() => expect(flags().at(-1)?.title).toBe('A diagram was already added to this page'))
    expect(m.reloadHostPage).not.toHaveBeenCalled()
  })
})
