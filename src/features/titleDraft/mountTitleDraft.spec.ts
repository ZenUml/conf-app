import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const m = vi.hoisted(() => ({
  renderMermaid: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
  trackAnalyticsEventBeforeUnload: vi.fn(),
  initializeContext: vi.fn(),
  addDraft: vi.fn(),
  close: vi.fn(),
  reloadPreview: vi.fn(),
}))
vi.mock('@/utils/mermaid/renderMermaid', () => ({ renderMermaid: m.renderMermaid }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: m.trackAnalyticsEvent,
  trackAnalyticsEventBeforeUnload: m.trackAnalyticsEventBeforeUnload,
}))
vi.mock('@/model/globals', () => ({ default: { apWrapper: { initializeContext: m.initializeContext } } }))
vi.mock('@/model/globals/forgeGlobal', () => ({ getView: async () => ({ close: m.close }) }))
vi.mock('./addDraft', () => ({ addDraft: m.addDraft }))
vi.mock('./previewReload', () => ({ reloadTitleDraftPreview: m.reloadPreview }))

import { mountTitleDraftModal, TITLE_DRAFT_TELEMETRY_TIMEOUT_MS } from './mountTitleDraft'

const modal = {
  macroMode: 'title-draft', pageId: '100', pageTitle: 'Order approval workflow',
  mermaid: 'sequenceDiagram\n Buyer->>Manager: Request approval', kind: 'sequence', confidence: 0.9,
}
const props = { feature_area: 'title_draft', surface: 'modal', macro_type: 'mermaid',
  page_id: '100', title_draft_kind: 'sequence', title_draft_confidence: 0.9 }

beforeEach(() => {
  vi.resetAllMocks()
  document.body.innerHTML = '<div id="app"></div>'
  m.renderMermaid.mockResolvedValue({ svg: '<svg data-testid="rendered-draft"></svg>' })
  m.trackAnalyticsEventBeforeUnload.mockResolvedValue(undefined)
  m.initializeContext.mockResolvedValue(undefined)
  m.addDraft.mockResolvedValue({ result: 'added', contentId: 'cc-1' })
})

afterEach(() => {
  const app = (document.getElementById('app') as any)?.__vue_app__
  app?.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('title draft modal instrumentation', () => {
  const exposure = { experimentId: 'title-draft-offer-copy', experimentVersion: 1,
    variant: 'B', exposureId: '11111111-1111-4111-8111-111111111111' }
  const experimentProps = { title_draft_experiment_id: 'title-draft-offer-copy', title_draft_experiment_version: 1,
    title_draft_variant: 'B', title_draft_exposure_id: exposure.exposureId }

  it.each(['A', 'B'])('retains explicit variant %s through iframe render, accepted click and successful add', async (variant) => {
    const contextExposure = { ...exposure, variant }
    mountTitleDraftModal({ extension: { modal: { ...modal, copyExperiment: contextExposure } } })
    // Modal context is an external object; downstream callbacks use a validated snapshot.
    contextExposure.variant = 'invalid'
    await flushPromises()
    document.querySelector('button')!.click()
    await flushPromises()
    const expected = { ...props, ...experimentProps, title_draft_variant: variant }
    expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_preview_mounted', expected)
    expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_preview_rendered', { ...expected, title_draft_render_ms: expect.any(Number) })
    expect(m.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith('title_draft_add_clicked', expected)
    expect(m.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith('title_draft_added', expected)
  })

  it('retains the explicit exposure on add failure', async () => {
    m.addDraft.mockResolvedValue({ result: 'forbidden' })
    mountTitleDraftModal({ extension: { modal: { ...modal, copyExperiment: exposure } } })
    await flushPromises()
    document.querySelector('button')!.click()
    await flushPromises()
    expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_add_failed', {
      ...props, ...experimentProps, title_draft_failure: 'forbidden',
    })
  })

  it('retains the explicit exposure on recoverable render failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.renderMermaid.mockRejectedValue(new Error('bad syntax'))
    mountTitleDraftModal({ extension: { modal: { ...modal, copyExperiment: exposure } } })
    await flushPromises()
    expect(m.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith('title_draft_preview_render_failed', { ...props, ...experimentProps, title_draft_render_failure: 'render_error', title_draft_render_ms: expect.any(Number) })
    expect(m.close).not.toHaveBeenCalled()
    expect(document.querySelector('[role=alert]')).not.toBeNull()
  })

  it.each([undefined, {}, { ...exposure, variant: 'C' }, { ...exposure, experimentVersion: 2 }, { ...exposure, exposureId: 'private text' }])(
    'keeps legacy or malformed modal attribution unassigned (%j)', async (copyExperiment) => {
      mountTitleDraftModal({ extension: { modal: { ...modal, copyExperiment } } })
      await flushPromises()
      document.querySelector('button')!.click()
      await flushPromises()
      expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_preview_mounted', props)
      expect(m.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith('title_draft_added', props)
    },
  )

  it('starts analytics at the real mount and reports success after SVG is committed', async () => {
    let finish!: (v: { svg: string }) => void
    m.renderMermaid.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    expect(mountTitleDraftModal({ extension: { modal } })).toBe(true)
    expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_preview_mounted', props)
    expect(m.trackAnalyticsEvent).not.toHaveBeenCalledWith('title_draft_preview_rendered', expect.anything())
    m.trackAnalyticsEvent.mockImplementation((event) => {
      if (event === 'title_draft_preview_rendered') expect(document.querySelector('[data-testid="rendered-draft"]')).not.toBeNull()
    })
    finish({ svg: '<svg data-testid="rendered-draft"></svg>' })
    await flushPromises()
    expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_preview_rendered', { ...props, title_draft_render_ms: expect.any(Number) })
    expect(JSON.stringify(m.trackAnalyticsEvent.mock.calls)).not.toContain(modal.pageTitle)
    expect(JSON.stringify(m.trackAnalyticsEvent.mock.calls)).not.toContain(modal.mermaid)
  })

  it('does not track a non-preview mount', () => {
    expect(mountTitleDraftModal({ extension: { modal: { macroMode: 'editor' } } })).toBe(false)
    expect(m.trackAnalyticsEvent).not.toHaveBeenCalled()
  })

  it('distinguishes a slow preview from failure and retains its exposure on late success', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let finish!: (value: { svg: string }) => void
    m.renderMermaid.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    mountTitleDraftModal({ extension: { modal: { ...modal, copyExperiment: exposure } } })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_preview_render_delayed', {
      ...props, ...experimentProps, title_draft_render_failure: 'timeout', title_draft_render_ms: expect.any(Number),
    })
    expect(m.trackAnalyticsEventBeforeUnload).not.toHaveBeenCalledWith('title_draft_preview_render_failed', expect.anything())
    finish({ svg: '<svg data-testid="late-valid-preview"></svg>' })
    await flushPromises()
    expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_preview_rendered', {
      ...props, ...experimentProps, title_draft_render_ms: expect.any(Number),
    })
    expect(document.querySelector('[data-testid="late-valid-preview"]')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('[data-testid="title-draft-add"]')!.disabled).toBe(false)
    expect(m.close).not.toHaveBeenCalled()
  })

  it('tracks one accepted add click before context/save, including retries', async () => {
    let finish!: () => void
    m.initializeContext.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    mountTitleDraftModal({ extension: { modal } })
    await flushPromises()
    const button = document.querySelector('button')!
    button.click()
    button.dispatchEvent(new MouseEvent('click'))
    expect(m.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith('title_draft_add_clicked', props)
    expect(m.trackAnalyticsEventBeforeUnload).toHaveBeenCalledTimes(1)
    expect(m.trackAnalyticsEventBeforeUnload.mock.invocationCallOrder[0]).toBeLessThan(m.initializeContext.mock.invocationCallOrder[0])
    m.addDraft.mockResolvedValueOnce({ result: 'forbidden' })
    finish()
    await flushPromises()
    expect(m.trackAnalyticsEvent).toHaveBeenCalledWith('title_draft_add_failed', { ...props, title_draft_failure: 'forbidden' })
    button.click()
    await flushPromises()
    expect(m.trackAnalyticsEventBeforeUnload.mock.calls.filter(c => c[0] === 'title_draft_add_clicked')).toHaveLength(2)
    expect(m.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith('title_draft_added', props)
    expect(m.close).toHaveBeenCalledWith({ outcome: 'added', contentId: 'cc-1' })
  })

  it('flushes the original exposure and bounded reason before reloading the preview', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.renderMermaid.mockRejectedValue(new Error('private broken source'))
    mountTitleDraftModal({ extension: { modal: { ...modal, copyExperiment: exposure } } })
    await flushPromises()
    expect(m.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith('title_draft_preview_render_failed', {
      ...props, ...experimentProps, title_draft_render_failure: 'render_error', title_draft_render_ms: expect.any(Number),
    })
    let tracked!: () => void
    m.trackAnalyticsEventBeforeUnload.mockImplementation(() => new Promise<void>(resolve => { tracked = resolve }))
    document.querySelector<HTMLButtonElement>('[data-testid="title-draft-reload"]')!.click()
    await flushPromises()
    expect(m.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith('title_draft_preview_reload_clicked', {
      ...props, ...experimentProps, title_draft_render_failure: 'render_error',
    })
    expect(m.reloadPreview).not.toHaveBeenCalled()
    tracked()
    await flushPromises()
    expect(m.reloadPreview).toHaveBeenCalledTimes(1)
    expect(m.close).not.toHaveBeenCalled()
    expect(JSON.stringify(m.trackAnalyticsEventBeforeUnload.mock.calls)).not.toContain('private broken source')
  })

  it('analytics failure neither blocks closing nor turns a successful render into failure', async () => {
    m.trackAnalyticsEvent.mockImplementation(() => { throw new Error('analytics unavailable') })
    mountTitleDraftModal({ extension: { modal } })
    await flushPromises()
    expect(document.querySelector('svg')).not.toBeNull()
    expect(m.trackAnalyticsEventBeforeUnload).not.toHaveBeenCalled()
    expect(m.close).not.toHaveBeenCalled()
    document.querySelector('button')!.click()
    await flushPromises()
    expect(m.addDraft).toHaveBeenCalledWith(modal.pageId, modal.pageTitle, modal.mermaid)
    expect(m.close).toHaveBeenCalledWith({ outcome: 'added', contentId: 'cc-1' })
  })

  it('keeps recovery available even if render failure telemetry rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.renderMermaid.mockRejectedValue(new Error('bad syntax'))
    m.trackAnalyticsEventBeforeUnload.mockRejectedValue(new Error('analytics unavailable'))
    mountTitleDraftModal({ extension: { modal } })
    await flushPromises()
    expect(m.close).not.toHaveBeenCalled()
    expect(document.querySelector('[role=alert]')).not.toBeNull()
  })

  it('queues click and terminal beacons before a fast successful save closes', async () => {
    const tracked: Record<string, () => void> = {}
    m.trackAnalyticsEventBeforeUnload.mockImplementation((event: string) => new Promise<void>(resolve => { tracked[event] = resolve }))
    mountTitleDraftModal({ extension: { modal } })
    await flushPromises()
    document.querySelector('button')!.click()
    await flushPromises()
    expect(m.addDraft).toHaveBeenCalledTimes(1)
    expect(m.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith('title_draft_added', props)
    expect(m.close).not.toHaveBeenCalled()
    tracked.title_draft_added()
    await flushPromises()
    expect(m.close).not.toHaveBeenCalled()
    tracked.title_draft_add_clicked()
    await flushPromises()
    expect(m.close).toHaveBeenCalledWith({ outcome: 'added', contentId: 'cc-1' })
  })

  it.each(['reload', 'add success'])('bounds never-resolving telemetry on %s', async (scenario) => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.trackAnalyticsEventBeforeUnload.mockImplementation(() => new Promise(() => {}))
    if (scenario === 'reload') m.renderMermaid.mockRejectedValue(new Error('bad syntax'))
    mountTitleDraftModal({ extension: { modal } })
    await flushPromises()
    if (scenario === 'add success') document.querySelector('button')!.click()
    else document.querySelector<HTMLButtonElement>('[data-testid=title-draft-reload]')!.click()
    await flushPromises()
    expect(m.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(TITLE_DRAFT_TELEMETRY_TIMEOUT_MS)
    if (scenario === 'add success') expect(m.close).toHaveBeenCalledTimes(1)
    else expect(m.reloadPreview).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
