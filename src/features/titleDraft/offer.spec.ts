import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const APP = '11111111-1111-4111-8111-111111111111'
const ENV = '22222222-2222-4222-8222-222222222222'

const m = vi.hoisted(() => ({
  showFlag: vi.fn(),
  openModal: vi.fn(),
  isTitleDraftEnabled: vi.fn(),
  isTitleDraftCopyExperimentEnabled: vi.fn(),
  viewerAccountKind: vi.fn(),
  requestConfluenceJson: vi.fn(),
  callRemote: vi.fn(),
  canEditPage: vi.fn(),
  readTitleDraftRecord: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
  reloadHostPage: vi.fn(),
  undoTitleDraft: vi.fn(),
  clientDomain: 'example-tenant',
  forge: { forgeContext: {} as any },
}))

vi.mock('@forge/bridge', () => ({ showFlag: m.showFlag }))
vi.mock('@/model/globals/forgeGlobal', () => ({ default: m.forge, openModal: m.openModal }))
vi.mock('@/model/globals', () => ({ default: { apWrapper: { initializeContext: vi.fn(async () => {}) } } }))
vi.mock('@/apis/aiTitleFeatureFlag', () => ({ isTitleDraftEnabled: m.isTitleDraftEnabled }))
vi.mock('@/utils/featureConstants', () => ({ isTitleDraftCopyExperimentEnabled: m.isTitleDraftCopyExperimentEnabled }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: m.trackAnalyticsEvent }))
vi.mock('@/utils/byline/addToPage', async (orig) => ({
  ...(await orig<typeof import('@/utils/byline/addToPage')>()),
  reloadHostPage: m.reloadHostPage,
}))
vi.mock('@/utils/byline/confluenceRequest', () => ({ requestConfluenceJson: m.requestConfluenceJson }))
vi.mock('@/utils/magic/viewerAccount', () => ({ viewerAccountKind: m.viewerAccountKind }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({ getClientDomain: () => m.clientDomain }))
vi.mock('@/utils/requestUtil', () => ({ callRemote: m.callRemote }))
vi.mock('./canEdit', () => ({ canEditPage: m.canEditPage }))
vi.mock('./pageState', () => ({ readTitleDraftRecord: m.readTitleDraftRecord }))
vi.mock('./undo', () => ({ undoTitleDraft: m.undoTitleDraft }))

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
  m.isTitleDraftCopyExperimentEnabled.mockReturnValue(false)
  m.clientDomain = 'example-tenant'
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
  m.undoTitleDraft.mockResolvedValue({ result: 'undone' })
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
    expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_preview_opened', expect.objectContaining({ surface: 'page_banner' }))
  })

  async function openAndClose(payload: unknown) {
    await maybeOfferTitleDraft('lite')
    actionOf(flags()[0], 'See diagram').onClick()
    await vi.waitFor(() => expect(m.openModal).toHaveBeenCalled())
    m.openModal.mock.calls[0][0].onClose(payload)
  }

  it.each([
    { payload: undefined, reason: 'host_dismissed' },
    { payload: { outcome: 'dismissed' }, reason: 'unknown' },
    { payload: { outcome: 'dismissed', reason: 'escape' }, reason: 'escape' },
    { payload: { outcome: 'dismissed', reason: 'render_failed' }, reason: 'render_failed' },
  ])('reports the close reason $reason once through the parent lifecycle', async ({ payload, reason }) => {
    await openAndClose(payload)
    m.openModal.mock.calls[0][0].onClose(payload)
    const closed = m.trackAnalyticsEvent.mock.calls.filter(c => c[0] === 'title_draft_preview_closed')
    expect(closed).toEqual([['title_draft_preview_closed', expect.objectContaining({
      surface: 'modal', page_id: '100', title_draft_kind: 'sequence', title_draft_confidence: 0.9,
      title_draft_close_reason: reason,
    })]])
  })

  it('closing with added reloads the host, and the next view shows the added flag', async () => {
    await openAndClose({ outcome: 'added', contentId: 'c1' })
    expect(m.reloadHostPage).toHaveBeenCalledTimes(1)
    expect(m.trackAnalyticsEvent.mock.calls.filter(c => c[0] === 'title_draft_preview_closed')).toHaveLength(0)

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
    expect(m.trackAnalyticsEvent.mock.calls.filter(c => c[0] === 'title_draft_preview_closed')).toHaveLength(0)
  })
})

describe('title draft offer copy attribution', () => {
  it('disabled builds retain exact original A copy without experiment attribution', async () => {
    await maybeOfferTitleDraft('lite')
    expect(flags()[0]).toMatchObject({
      title: 'A diagram for this page is ready',
      description: 'ZenUML sketched it from the page title. Nothing changes until you add it.',
    })
    expect(flags()[0].actions.map((a: any) => a.text)).toEqual(['See diagram', 'Not now'])
    actionOf(flags()[0], 'See diagram').onClick()
    await vi.waitFor(() => expect(m.openModal).toHaveBeenCalled())
    expect(m.openModal.mock.calls[0][0].context).not.toHaveProperty('copyExperiment')
    for (const [, props] of m.trackAnalyticsEvent.mock.calls) {
      expect(Object.keys(props).filter(key => /title_draft_(experiment|variant|exposure)/.test(key))).toEqual([])
    }
  })

  const cases = [
    { account: 'acc-1', variant: 'A', title: 'A diagram for this page is ready',
      description: 'ZenUML sketched it from the page title. Nothing changes until you add it.', primary: 'See diagram' },
    { account: 'account-1', variant: 'B', title: 'Help readers understand this page',
      description: 'Preview a draft diagram based on the page title. Your page stays unchanged until you add it.', primary: 'Preview diagram' },
  ]
  it.each(cases)('shows exact $variant copy and propagates one exposure through the callbacks', async ({ account, variant, title, description, primary }) => {
    m.isTitleDraftCopyExperimentEnabled.mockReturnValue(true)
    m.forge.forgeContext.accountId = account
    await maybeOfferTitleDraft('lite')
    const flag = flags()[0]
    expect(flag).toMatchObject({ title, description })
    expect(flag.actions.map((a: any) => a.text)).toEqual([primary, 'Not now'])
    const shown = m.trackAnalyticsEvent.mock.calls.find(c => c[0] === 'title_draft_flag_shown')![1]
    expect(shown).toMatchObject({ title_draft_experiment_id: 'title-draft-offer-copy', title_draft_experiment_version: 1, title_draft_variant: variant, title_draft_exposure_id: expect.any(String) })
    expect(m.trackAnalyticsEvent.mock.calls.find(c => c[0] === 'title_draft_requested')![1]).not.toHaveProperty('title_draft_variant')
    actionOf(flag, primary).onClick()
    await vi.waitFor(() => expect(m.openModal).toHaveBeenCalled())
    const modal = m.openModal.mock.calls[0][0]
    expect(modal.context.copyExperiment).toEqual({
      experimentId: shown.title_draft_experiment_id, experimentVersion: shown.title_draft_experiment_version,
      variant, exposureId: shown.title_draft_exposure_id,
    })
    expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_preview_opened', shown)
    // A changed identity/build state cannot reassign this already-rendered flag.
    m.forge.forgeContext.accountId = 'another-account'
    m.isTitleDraftCopyExperimentEnabled.mockReturnValue(false)
    actionOf(flag, 'Not now').onClick()
    expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_not_now', shown)
    modal.onClose({ outcome: 'dismissed', reason: 'escape' })
    expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_preview_closed', { ...shown, surface: 'modal', page_id: '100', title_draft_close_reason: 'escape' })
    expect(m.isTitleDraftCopyExperimentEnabled).toHaveBeenCalledTimes(1)
    const serialized = JSON.stringify(m.trackAnalyticsEvent.mock.calls)
    expect(serialized).not.toContain(TITLE)
    expect(serialized).not.toContain(MERMAID)
    for (const [, eventProps] of m.trackAnalyticsEvent.mock.calls) expect(Object.values(eventProps)).not.toContain(account)
  })

  it('keeps the cohort across pages, sites and fresh storage but gives each show a new exposure', async () => {
    m.isTitleDraftCopyExperimentEnabled.mockReturnValue(true)
    await maybeOfferTitleDraft('lite')
    const first = m.trackAnalyticsEvent.mock.calls.find(c => c[0] === 'title_draft_flag_shown')![1]
    localStorage.clear()
    setPage('200')
    m.clientDomain = 'other-tenant'
    await maybeOfferTitleDraft('lite')
    const second = m.trackAnalyticsEvent.mock.calls.filter(c => c[0] === 'title_draft_flag_shown')[1][1]
    expect(second.title_draft_variant).toBe(first.title_draft_variant)
    expect(second.title_draft_exposure_id).not.toBe(first.title_draft_exposure_id)
  })

  it.each(['Edit diagram', 'Undo'])('retains the exposure through reload and $0', async (action) => {
    m.isTitleDraftCopyExperimentEnabled.mockReturnValue(true)
    m.forge.forgeContext.accountId = 'account-1'
    await maybeOfferTitleDraft('lite')
    actionOf(flags()[0], 'Preview diagram').onClick()
    await vi.waitFor(() => expect(m.openModal).toHaveBeenCalled())
    const modal = m.openModal.mock.calls[0][0]
    const exposureId = modal.context.copyExperiment.exposureId
    modal.onClose({ outcome: 'added', contentId: 'cc-1' })
    m.isTitleDraftCopyExperimentEnabled.mockReturnValue(false)
    await maybeOfferTitleDraft('lite')
    actionOf(flags().at(-1), action).onClick()
    await vi.waitFor(() => expect(m.trackAnalyticsEvent).toHaveBeenCalledWith(action === 'Undo' ? 'title_draft_undone' : 'title_draft_edit_clicked', expect.objectContaining({
      title_draft_variant: 'B', title_draft_exposure_id: exposureId,
    })))
    expect(m.isTitleDraftCopyExperimentEnabled).toHaveBeenCalledTimes(1)
  })
})
