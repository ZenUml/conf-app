import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DiagramLocations from './DiagramLocations.vue'
import { ForgeRequestError } from '@/utils/forgeRequestError'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

vi.mock('@/model/globals/forgeGlobal', () => ({ openUrl: vi.fn(async () => {}) }))
import { openUrl } from '@/model/globals/forgeGlobal'

vi.mock('@/model/globals', () => ({
  default: { apWrapper: { getMacroContentTypes: () => ['ac:lite:zenuml-content-sequence'] } },
}))

const resolveSpaces = vi.fn()
const loadDiagramLocations = vi.fn()
vi.mock('@/utils/planUsage/diagramLocations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/planUsage/diagramLocations')>()
  return {
    ...actual,
    confluenceGet: vi.fn(),
    resolveSpaces: (...args: unknown[]) => resolveSpaces(...args),
    loadDiagramLocations: (...args: unknown[]) => loadDiagramLocations(...args),
  }
})

const ENG = { id: '301', key: 'ENG', name: 'Engineering' }
const OPS = { id: '302', key: 'OPS', name: 'Operations' }
const SUMMARIES = [
  { spaceKey: 'ENG', macroCount: 12, lastUpdated: '2026-10-22T00:00:00.000Z' },
  { spaceKey: 'OPS', macroCount: 9, lastUpdated: null },
  { spaceKey: 'HR', macroCount: 4, lastUpdated: null },
]

function row(over: Record<string, unknown> = {}) {
  return {
    contentId: '1001',
    diagramTitle: 'Checkout flow',
    spaceKey: 'ENG',
    spaceName: 'Engineering',
    diagramType: 'sequence',
    macroType: 'sequence',
    containerKind: 'page',
    pageId: '201',
    pageTitle: 'Checkout design',
    pageUrl: 'https://example.atlassian.net/wiki/spaces/ENG/pages/201/Checkout',
    updatedAt: '2026-10-20T01:02:03.000Z',
    ...over,
  }
}

function batch(over: Record<string, unknown> = {}) {
  return { outcome: 'ok', rows: [row()], hiddenCount: 0, next: null, fetchedAt: '2026-10-23T02:00:00.000Z', ...over }
}

const ENG_ROWS = [
  row(),
  row({ contentId: '1002', diagramTitle: 'Payment retry', pageTitle: 'Checkout design' }),
  row({ contentId: '1003', diagramTitle: 'Release pipeline', diagramType: 'graph', macroType: 'graph', pageId: '202', pageTitle: 'Delivery pipeline' }),
]
const OPS_ROWS = [
  row({ contentId: '2001', diagramTitle: 'Access flow', spaceKey: 'OPS', spaceName: 'Operations', pageId: '401', pageTitle: 'Access model' }),
]

const events = () => vi.mocked(trackAnalyticsEvent).mock.calls.map(([name, props]) => ({ name, props }))
const names = () => events().map((e) => e.name)

function mountScreen(spaces = SUMMARIES, totalMacros = 25, attach = false) {
  return mount(DiagramLocations, { props: { spaces, totalMacros }, ...(attach ? { attachTo: document.body } : {}) })
}

describe('DiagramLocations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveSpaces.mockResolvedValue([ENG, OPS])
    loadDiagramLocations.mockImplementation(async (_get: unknown, opts: { space: { key: string } }) =>
      batch({ rows: opts.space.key === 'ENG' ? ENG_ROWS : OPS_ROWS }))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens by resolving the reported spaces as the viewer and reading each visible one, largest first', async () => {
    const w = mountScreen()
    await flushPromises()

    expect(events()[0]).toEqual({
      name: 'plan_usage_locations_shown',
      props: { feature_area: 'upgrade', surface: 'dashboard', space_count: 3, macro_count: 25 },
    })
    expect(resolveSpaces).toHaveBeenCalledWith(expect.anything(), ['ENG', 'OPS', 'HR'])
    expect(loadDiagramLocations.mock.calls.map((c) => c[1])).toEqual([
      { space: ENG, types: ['ac:lite:zenuml-content-sequence'], cursor: null, limit: 100 },
      { space: OPS, types: ['ac:lite:zenuml-content-sequence'], cursor: null, limit: 100 },
    ])
    expect(w.get('[data-testid="diagram-locations-summary"]').text()).toBe('4 diagrams on 3 pages in 2 spaces')
    expect(w.findAll('[data-testid="diagram-locations-row"]')).toHaveLength(4)
    expect(w.get('[data-testid="diagram-locations-range"]').text()).toBe('1–4 of 4')
    expect(w.get('[data-testid="diagram-locations-status"]').text()).toMatch(/Fetched at/)
    // A space the viewer cannot see is neither listed nor offered as a filter.
    expect(w.get('[data-testid="diagram-locations-space-filter"]').text()).not.toContain('HR')
    expect(w.get('[data-testid="diagram-locations-coverage"]').text()).toContain('site count of 25')
    expect(w.get('[data-testid="diagram-locations-coverage"]').text()).toBe(
      'This list can miss diagrams and may not match the site count of 25. It shows the page that owns each diagram, not pages that embed it.')
    expect(w.text()).not.toContain('Last updated')
    expect(w.text()).not.toContain('Rows per page')
    expect(w.text()).not.toMatch(/Page \d+ of/)
    const loaded = events().filter((e) => e.name === 'plan_usage_locations_loaded')
    expect(loaded.map((e) => e.props.page_index)).toEqual([0, 1])
    expect(loaded[0].props).toMatchObject({ load_outcome: 'ok', listed_count: 3, hidden_count: 0, has_more: false })
  })

  it('keeps the heading and coverage note visible while the first batch loads, with no count', async () => {
    let release!: () => void
    loadDiagramLocations.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(batch({ rows: ENG_ROWS })) }))
    const w = mountScreen()
    await flushPromises()
    expect(w.find('[data-testid="diagram-locations-loading"]').exists()).toBe(true)
    expect(w.find('[data-testid="diagram-locations-summary"]').exists()).toBe(false)
    expect(w.get('[data-testid="diagram-locations-coverage"]').exists()).toBe(true)
    release()
    await flushPromises()
    expect(w.find('[data-testid="diagram-locations-loading"]').exists()).toBe(false)
    expect(w.find('[data-testid="diagram-locations-summary"]').exists()).toBe(true)
  })

  it('shows the empty state only after every space answered with nothing, and it leads back', async () => {
    loadDiagramLocations.mockResolvedValue(batch({ outcome: 'empty', rows: [] }))
    const w = mountScreen()
    await flushPromises()
    const empty = w.get('[data-testid="diagram-locations-none"]')
    expect(empty.text()).toContain('No diagram locations available yet')
    await empty.get('button').trigger('click')
    expect(w.emitted('back')).toHaveLength(1)
  })

  it('a failed load is not an empty state: it offers Retry, which resumes, and reports the HTTP status', async () => {
    resolveSpaces.mockRejectedValueOnce(new ForgeRequestError({ status: 500, method: 'GET', url: '/wiki/api/v2/spaces', contentType: 'application/json', body: '{}', nonJson: false }))
    const w = mountScreen()
    await flushPromises()
    expect(w.find('[data-testid="diagram-locations-failed"]').exists()).toBe(true)
    expect(w.find('[data-testid="diagram-locations-none"]').exists()).toBe(false)
    expect(events().at(-1)).toMatchObject({ name: 'plan_usage_locations_load_failed', props: { load_outcome: 'failed', http_status: 500 } })

    await w.get('[data-testid="diagram-locations-retry"]').trigger('click')
    await flushPromises()
    expect(w.findAll('[data-testid="diagram-locations-row"]')).toHaveLength(4)
  })

  it('"Open page" opens the owning page in a new tab and reports the diagram type', async () => {
    const w = mountScreen()
    await flushPromises()
    await w.findAll('[data-testid="diagram-locations-page-link"]')[0].trigger('click')
    expect(openUrl).toHaveBeenCalledWith('https://example.atlassian.net/wiki/spaces/ENG/pages/201/Checkout')
    expect(events().at(-1)).toMatchObject({ name: 'plan_usage_locations_page_clicked', props: { macro_type: 'sequence' } })
  })

  it('search matches diagram and owning-page titles after a 300 ms pause, Enter applies at once, and Clear filters restores the list', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const w = mountScreen()
    await flushPromises()
    const search = w.get('[data-testid="diagram-locations-search"]')

    await search.setValue('payment')
    expect(w.findAll('[data-testid="diagram-locations-row"]')).toHaveLength(4)
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(w.findAll('[data-testid="diagram-locations-row"]').map((r) => r.text())).toEqual([expect.stringContaining('Payment retry')])
    expect(w.get('[data-testid="diagram-locations-summary"]').text()).toBe('1 diagram on 1 page in 1 space')
    expect(w.get('[data-testid="diagram-locations-range"]').text()).toBe('1–1 of 1')

    await search.setValue('delivery')
    await search.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(w.findAll('[data-testid="diagram-locations-row"]').map((r) => r.text())).toEqual([expect.stringContaining('Release pipeline')])

    await search.setValue('nothing here')
    await search.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(w.get('[data-testid="diagram-locations-no-match"]').text()).toContain('No matching diagrams')
    expect(w.find('[data-testid="diagram-locations-pager"]').exists()).toBe(false)

    await w.get('[data-testid="diagram-locations-clear"]').trigger('click')
    await flushPromises()
    expect(w.findAll('[data-testid="diagram-locations-row"]')).toHaveLength(4)
    expect((search.element as HTMLInputElement).value).toBe('')
    expect(names().filter((n) => n === 'plan_usage_locations_filtered')).toHaveLength(4)
    expect(events().filter((e) => e.name === 'plan_usage_locations_filtered').map((e) => e.props.locations_filter)).toEqual(['search', 'search', 'search', 'clear'])
  })

  it('space and type filters narrow the list and only offer what was loaded', async () => {
    const w = mountScreen()
    await flushPromises()
    const space = w.get('[data-testid="diagram-locations-space-filter"]')
    expect(space.findAll('option').map((o) => o.text())).toEqual(['All spaces', 'Engineering', 'Operations'])
    await space.setValue('OPS')
    expect(w.findAll('[data-testid="diagram-locations-row"]').map((r) => r.text())).toEqual([expect.stringContaining('Access flow')])

    await space.setValue('')
    const type = w.get('[data-testid="diagram-locations-type-filter"]')
    expect(type.findAll('option').map((o) => o.text())).toEqual(['All types', 'Sequence', 'Graph'])
    await type.setValue('graph')
    expect(w.findAll('[data-testid="diagram-locations-row"]').map((r) => r.text())).toEqual([expect.stringContaining('Release pipeline')])
    expect(events().filter((e) => e.name === 'plan_usage_locations_filtered').map((e) => e.props.locations_filter)).toEqual(['space', 'space', 'type'])
  })

  it('pages the sorted list ten at a time, with Previous / Next bounds', async () => {
    const many = Array.from({ length: 25 }, (_, i) => row({ contentId: `d${i}`, diagramTitle: `Diagram ${String(i).padStart(2, '0')}` }))
    loadDiagramLocations.mockImplementation(async (_get: unknown, opts: { space: { key: string } }) =>
      batch({ rows: opts.space.key === 'ENG' ? many : [] }))
    const w = mountScreen(SUMMARIES, 25, true)
    await flushPromises()

    expect(w.get('[data-testid="diagram-locations-range"]').text()).toBe('1–10 of 25')
    expect(w.find('[data-testid="diagram-locations-page-pos"]').exists()).toBe(false)
    expect(w.text()).not.toMatch(/Page \d+ of/)
    expect(w.text()).not.toContain('Rows per page')
    expect(w.find('[data-testid="diagram-locations-page-size"]').exists()).toBe(false)
    expect(w.get('[data-testid="diagram-locations-prev"]').attributes('disabled')).toBeDefined()
    expect(w.findAll('[data-testid="diagram-locations-row"]')[0].text()).toContain('Diagram 00')

    await w.get('[data-testid="diagram-locations-next"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="diagram-locations-range"]').text()).toBe('11–20 of 25')
    expect(w.findAll('[data-testid="diagram-locations-row"]')[0].text()).toContain('Diagram 10')
    expect(document.activeElement).toBe(w.get('[data-testid="diagram-locations-summary"]').element)

    await w.get('[data-testid="diagram-locations-next"]').trigger('click')
    expect(w.get('[data-testid="diagram-locations-range"]').text()).toBe('21–25 of 25')
    expect(w.get('[data-testid="diagram-locations-next"]').attributes('disabled')).toBeDefined()

    expect(events().filter((e) => e.name === 'plan_usage_locations_filtered').map((e) => e.props.locations_filter)).toEqual(['page', 'page'])
    w.unmount()
  })

  it('pauses after the run budget and continues from the cursor on "Load more spaces"', async () => {
    const first = Array.from({ length: 500 }, (_, i) => row({ contentId: `a${i}`, diagramTitle: `A ${i}` }))
    const next = { typeIndex: 0, nextUrl: '/api/v2/spaces/301/custom-content?cursor=c2' }
    loadDiagramLocations
      .mockResolvedValueOnce(batch({ rows: first, next }))
      .mockResolvedValueOnce(batch({ rows: [row({ contentId: 'b1', diagramTitle: 'B 1' })] }))
      .mockResolvedValueOnce(batch({ rows: OPS_ROWS }))
    const w = mountScreen()
    await flushPromises()

    expect(w.get('[data-testid="diagram-locations-status"]').text()).toContain('Loaded 500 diagrams from 0 of 2 spaces')
    expect(loadDiagramLocations).toHaveBeenCalledTimes(1)

    await w.get('[data-testid="diagram-locations-more"]').trigger('click')
    await flushPromises()
    expect(loadDiagramLocations.mock.calls[1][1]).toMatchObject({ space: ENG, cursor: next })
    expect(loadDiagramLocations.mock.calls[2][1]).toMatchObject({ space: OPS, cursor: null })
    expect(w.get('[data-testid="diagram-locations-range"]').text()).toBe('1–10 of 502')
    expect(w.get('[data-testid="diagram-locations-status"]').text()).toMatch(/Fetched at/)
  })

  it('ignores responses that land after the screen is left', async () => {
    let release!: () => void
    loadDiagramLocations.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(batch({ rows: ENG_ROWS })) }))
    const w = mountScreen()
    await flushPromises()
    w.unmount()
    release()
    await flushPromises()
    expect(names().filter((n) => n === 'plan_usage_locations_loaded')).toHaveLength(0)
  })
})
