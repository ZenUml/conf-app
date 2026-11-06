import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import PlanUsage from './PlanUsage.vue'
import globals from '@/model/globals'
import { resetStubResponses, stubResponses } from '@/stubs/forge-bridge'

type Story = StoryObj<typeof PlanUsage>

// --- Fixture site -----------------------------------------------------------
// An example tenant with three spaces that reported counts. ENG holds 25
// sequence-family diagrams over two Confluence pages plus one graph, OPS
// nine, HR is a space this viewer cannot see. Every title is fictional.

const BASE = 'https://example.atlassian.net/wiki'

const usage = {
  domain: 'example-tenant',
  hasData: true,
  totalMacros: 131,
  spaceCount: 3,
  macrosLimit: 100,
  overLimitSpaces: [{ spaceKey: 'ENG', macroCount: 118 }],
  spaces: [
    { spaceKey: 'ENG', macroCount: 118, lastUpdated: '2026-10-22T20:10:00.000Z' },
    { spaceKey: 'OPS', macroCount: 9, lastUpdated: '2026-10-21T07:00:00.000Z' },
    { spaceKey: 'HR', macroCount: 4, lastUpdated: null },
  ],
  lastUpdated: '2026-10-22T20:10:00.000Z',
  isStale: false,
}

function cc(id: string, title: string, diagramType: string, pageId: string, updated: string) {
  return {
    id,
    title,
    pageId,
    version: { number: 2, createdAt: updated },
    body: { raw: { value: JSON.stringify({ diagramType }) } },
  }
}

function page(id: string, key: string, title: string) {
  return { id, title, _links: { webui: `/spaces/${key}/pages/${id}/${encodeURIComponent(title)}` } }
}

const ENG_TITLES = [
  'Checkout flow', 'Payment retry', 'Order events', 'Build checks', 'Access flow', 'Service map', 'Catalog API',
  'Catalog request', 'Refund path', 'Cart merge', 'Session refresh', 'Rate limiting', 'Webhook retry',
  'Inventory sync', 'Price lookup', 'Search indexing', 'Login handshake', 'Token rotation', 'Audit trail',
  'Export job', 'Import job', 'Nightly rollup', 'Alert routing', 'Backfill run', 'Cache warmup',
]
const ENG_TYPES = ['sequence', 'sequence', 'mermaid', 'plantuml', 'sequence', 'mermaid', 'OpenAPI']
const ENG_PAGES = ['201', '202']
const engSequence = ENG_TITLES.map((title, i) =>
  cc(`1${String(i).padStart(3, '0')}`, title, ENG_TYPES[i % ENG_TYPES.length], ENG_PAGES[i % 2], `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T09:00:00.000Z`))
// One record whose page the viewer cannot read: counted in telemetry, never shown.
engSequence.push(cc('1999', 'Restricted design', 'sequence', '299', '2026-09-01T10:00:00.000Z'))

const OPS_TITLES = ['Deploy pipeline', 'Rollback steps', 'Incident flow', 'On-call handover', 'Backup verify', 'Release train', 'Patch window', 'Capacity check', 'DNS cutover']
const opsSequence = OPS_TITLES.map((title, i) => cc(`2${String(i).padStart(3, '0')}`, title, i % 3 === 0 ? 'mermaid' : 'sequence', '401', `2026-10-${String(2 + i).padStart(2, '0')}T11:00:00.000Z`))

const pages = {
  _links: { base: BASE },
  results: [
    page('201', 'ENG', 'Checkout design'),
    page('202', 'ENG', 'Delivery pipeline'),
    page('401', 'OPS', 'Runbooks'),
    page('402', 'OPS', 'Infrastructure'),
    // 299 is deliberately absent: the viewer cannot read that page.
  ],
}

function typeMatch(spaceId: string, suffix: string): string {
  const type = globals.apWrapper.getMacroContentTypes().find((t) => t.endsWith(suffix)) ?? suffix
  return `/spaces/${spaceId}/custom-content?type=${encodeURIComponent(type)}&body-format`
}

function installStubs(overrides: Array<{ match: string; status?: number; body: any }> = []) {
  resetStubResponses()
  stubResponses.confluence = [
    ...overrides,
    { match: '/api/v2/spaces?keys=', body: { results: [{ id: '301', key: 'ENG', name: 'Engineering' }, { id: '302', key: 'OPS', name: 'Operations' }] } },
    { match: 'cursor=eng2', body: { results: engSequence.slice(12), _links: {} } },
    { match: typeMatch('301', 'zenuml-content-sequence'), body: { results: engSequence.slice(0, 12), _links: { next: '/wiki/api/v2/spaces/301/custom-content?cursor=eng2' } } },
    { match: typeMatch('301', 'zenuml-content-graph'), body: { results: [cc('3001', 'Network topology', 'graph', '402', '2026-10-01T11:00:00.000Z')], _links: {} } },
    { match: typeMatch('302', 'zenuml-content-sequence'), body: { results: opsSequence, _links: {} } },
    { match: typeMatch('302', 'zenuml-content-graph'), body: { results: [], _links: {} } },
    { match: '/api/v2/pages?', body: pages },
  ]
}

function stubFetch(body: unknown, status = 200) {
  const original = window.fetch
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/api/plan-usage')) {
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    }
    return original(input, init)
  }) as typeof window.fetch
  return () => { window.fetch = original }
}

const meta: Meta<typeof PlanUsage> = {
  title: 'Plan and usage/PlanUsage',
  component: PlanUsage,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The Lite confluence:globalPage "Plan and usage" (route zenuml-plan-usage) and its ' +
          '"Diagram locations" screen (conf-app#848). The usage view reads site totals and spaces ' +
          'over the Lite limit from our KV aggregate; "View diagram locations" opens the list of ' +
          'stored diagrams with the page each one was created on, read through requestConfluence as ' +
          'the viewer so Confluence applies their space and page permissions (a page they cannot ' +
          'read is omitted, never named or counted on screen). Counts are stored diagrams, never ' +
          'macro placements: a page that embeds a diagram stored elsewhere is not enumerated. ' +
          'Spaces load largest first, 100 records a fetch, and a run pauses after 500 records with ' +
          '"Load more spaces". Open stories from the manager sidebar — the preview must be nested in ' +
          'the manager for the bridge stub to serve the Confluence calls.',
      },
    },
  },
  beforeEach: () => {
    installStubs()
    try { window.localStorage.setItem('mockClientDomain', 'example-tenant') } catch { /* ignore */ }
    const restore = stubFetch(usage)
    return () => { restore(); resetStubResponses() }
  },
}

export default meta

// Spaces load one after another, so wait for the run to finish ("Fetched at")
// before asserting totals: the summary is live from the first batch.
async function openLocations(canvas: ReturnType<typeof within>) {
  await userEvent.click(await canvas.findByTestId('plan-usage-view-locations'))
  await expect(await canvas.findByTestId('diagram-locations-summary', {}, { timeout: 5000 })).toBeVisible()
  await waitFor(() => expect(canvas.getByTestId('diagram-locations-status')).toHaveTextContent('Fetched at'), { timeout: 5000 })
}

/** The usage view: the count card carries the way to its locations; nothing is fetched yet. */
export const Default: Story = {
  name: 'Plan and usage — count card leads to locations',
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText('Diagrams reported across the site')).toBeVisible()
    await expect(canvas.getByTestId('plan-usage-view-locations')).toBeEnabled()
    await expect(canvas.getByTestId('plan-usage-count-note')).toHaveTextContent('may not match this total')
    await expect(canvas.queryByTestId('diagram-locations')).not.toBeInTheDocument()
  },
}

/** Diagram locations: the viewer's two visible spaces listed, HR never named. */
export const Locations: Story = {
  name: 'Diagram locations — list, coverage note, pager',
  play: async () => {
    const canvas = within(document.body)
    await openLocations(canvas)
    await expect(canvas.getByTestId('diagram-locations-coverage')).toHaveTextContent('reported site count of 131')
    await expect(canvas.getByTestId('diagram-locations-summary')).toHaveTextContent('35 available diagrams · 4 owning pages · 2 spaces')
    await expect(canvas.getByTestId('diagram-locations-range')).toHaveTextContent('1–10 of 35 available diagrams')
    await expect(canvas.getByTestId('diagram-locations-space-filter')).not.toHaveTextContent('HR')
    await expect(canvas.queryByText('Restricted design')).not.toBeInTheDocument()
    await expect(canvas.getByTestId('diagram-locations-status')).toHaveTextContent('Fetched at')
  },
}

/** Search and filters reset to page 1; Clear filters restores everything. */
export const SearchAndFilters: Story = {
  name: 'Search, space and type filters',
  play: async () => {
    const canvas = within(document.body)
    await openLocations(canvas)
    await userEvent.type(canvas.getByTestId('diagram-locations-search'), 'retry{enter}')
    await expect(canvas.getByTestId('diagram-locations-summary')).toHaveTextContent('2 matching diagrams')
    await userEvent.selectOptions(canvas.getByTestId('diagram-locations-space-filter'), 'OPS')
    await expect(canvas.getByTestId('diagram-locations-summary')).toHaveTextContent('0 matching diagrams')
    await expect(canvas.getByTestId('diagram-locations-no-match')).toBeVisible()
    await userEvent.click(canvas.getByTestId('diagram-locations-clear'))
    await expect(canvas.getByTestId('diagram-locations-summary')).toHaveTextContent('35 available diagrams')
    await userEvent.selectOptions(canvas.getByTestId('diagram-locations-type-filter'), 'graph')
    await expect(canvas.getByTestId('diagram-locations-summary')).toHaveTextContent('1 matching diagram ·')
  },
}

/** Paging keeps a stable title order; Previous / Next stop at the ends. */
export const Pagination: Story = {
  name: 'Pagination — ten rows a page',
  play: async () => {
    const canvas = within(document.body)
    await openLocations(canvas)
    await expect(canvas.getByTestId('diagram-locations-page-pos')).toHaveTextContent('Page 1 of 4')
    await expect(canvas.getByTestId('diagram-locations-prev')).toBeDisabled()
    await userEvent.click(canvas.getByTestId('diagram-locations-next'))
    await expect(canvas.getByTestId('diagram-locations-range')).toHaveTextContent('11–20 of 35 available diagrams')
    await userEvent.selectOptions(canvas.getByTestId('diagram-locations-page-size'), '50')
    await expect(canvas.getByTestId('diagram-locations-page-pos')).toHaveTextContent('Page 1 of 1')
    await expect(canvas.getByTestId('diagram-locations-next')).toBeDisabled()
  },
}

/** A site whose spaces answer with no records: the empty state, not a failure. */
export const Empty: Story = {
  name: 'No diagram locations available yet',
  beforeEach: () => {
    installStubs([
      { match: '/spaces/301/custom-content', body: { results: [], _links: {} } },
      { match: '/spaces/302/custom-content', body: { results: [], _links: {} } },
    ])
  },
  play: async () => {
    const canvas = within(document.body)
    await userEvent.click(await canvas.findByTestId('plan-usage-view-locations'))
    await expect(await canvas.findByTestId('diagram-locations-none', {}, { timeout: 5000 })).toBeVisible()
    await userEvent.click(canvas.getByText('Back to Plan and usage'))
    await expect(await canvas.findByTestId('plan-usage-view-locations')).toBeVisible()
  },
}

/** Confluence answers 500: the failure state with Retry, never a false empty list. */
export const LoadFailed: Story = {
  name: 'Load failed — retry offered',
  beforeEach: () => {
    installStubs([{ match: '/api/v2/spaces?keys=', status: 500, body: { message: 'boom' } }])
  },
  play: async () => {
    const canvas = within(document.body)
    await userEvent.click(await canvas.findByTestId('plan-usage-view-locations'))
    await expect(await canvas.findByTestId('diagram-locations-failed', {}, { timeout: 5000 })).toBeVisible()
    await expect(canvas.getByTestId('diagram-locations-retry')).toBeEnabled()
  },
}

/** A site where no space has reported a count yet. */
export const NoReportedSpaces: Story = {
  name: 'No counts reported yet',
  beforeEach: () => {
    const restore = stubFetch({ ...usage, totalMacros: 0, spaceCount: 0, overLimitSpaces: [], spaces: [], lastUpdated: null, isStale: null })
    return () => restore()
  },
  play: async () => {
    const canvas = within(document.body)
    await userEvent.click(await canvas.findByTestId('plan-usage-view-locations'))
    await expect(await canvas.findByTestId('diagram-locations-none', {}, { timeout: 5000 })).toBeVisible()
  },
}
