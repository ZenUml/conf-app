import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PlanUsage from './PlanUsage.vue'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
  getSpaceKey: () => 'ENG',
}))
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { zenumlRemoteBaseUrl: 'https://api.example.test' },
  openUrl: vi.fn(),
}))

// The locations screen has its own spec; here it only needs to echo its props.
const DiagramLocationsStub = {
  name: 'DiagramLocations',
  props: ['spaces', 'totalMacros'],
  template: '<div data-testid="locations-stub">{{ spaces.map((s) => `${s.spaceKey}:${s.macroCount}`).join(",") }}|{{ totalMacros }}</div>',
}

function usageBody(over: Record<string, unknown> = {}) {
  return {
    domain: 'example-tenant',
    hasData: true,
    totalMacros: 131,
    spaceCount: 3,
    macrosLimit: 100,
    overLimitSpaces: [{ spaceKey: 'ENG', macroCount: 118 }],
    lastUpdated: '2026-10-22T20:10:00.000Z',
    isStale: false,
    ...over,
  }
}

async function mountPage(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
  const w = mount(PlanUsage, { global: { stubs: { DiagramLocations: DiagramLocationsStub } } })
  await flushPromises()
  return w
}

describe('PlanUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hands every reported space and the site total to the Diagram locations screen', async () => {
    const w = await mountPage(usageBody({
      spaces: [
        { spaceKey: 'ENG', macroCount: 118, lastUpdated: '2026-10-22T20:10:00.000Z' },
        { spaceKey: 'OPS', macroCount: 9, lastUpdated: null },
      ],
    }))
    expect(w.find('[data-testid="locations-stub"]').exists()).toBe(false)
    await w.get('[data-testid="plan-usage-view-locations"]').trigger('click')
    expect(w.get('[data-testid="locations-stub"]').text()).toBe('ENG:118,OPS:9|131')
  })

  it('falls back to the over-limit spaces when the backend predates the `spaces` field', async () => {
    const w = await mountPage(usageBody())
    await w.get('[data-testid="plan-usage-view-locations"]').trigger('click')
    expect(w.get('[data-testid="locations-stub"]').text()).toBe('ENG:118|131')
  })

  it('shows the stats row, the over-limit table and the upgrade block with the approved copy', async () => {
    const w = await mountPage(usageBody())
    const text = w.text().replace(/\s+/g, ' ')
    expect(text).toContain('Diagrams on this site')
    expect(text).toContain('Spaces over the Lite limit of 100')
    expect(w.get('[data-testid="plan-usage-view-locations"]').text()).toBe('View locations')
    expect(w.get('[data-testid="plan-usage-count-note"]').text()).toBe('Both counts update every few hours.')
    expect(text).toContain('118 / 100')
    expect(text).toContain('Diagrams / limit')
    expect(text).toContain('Upgrade to Full')
    expect(text).toContain('Full removes the per-space limit on every space on this site. Atlassian Marketplace handles pricing and purchase.')
    expect(w.get('[data-testid="plan-usage-purchase"]').text()).toBe('View on Marketplace')
    // Removed copy and elements.
    expect(text).not.toContain('Over limit')
    expect(text).not.toContain('Status')
    expect(text).not.toContain('does not process payment')
    expect(text).not.toContain('installing/upgrading')
    expect(text).not.toContain('estimate, not a live inventory')
    expect(w.find('.badge-overlimit').exists()).toBe(false)
  })

  it('uses the same count note whether or not the data is stale', async () => {
    const stale = await mountPage(usageBody({ isStale: true }))
    expect(stale.get('[data-testid="plan-usage-count-note"]').text()).toBe('Both counts update every few hours.')
  })

  it('Request Full view has a back link, the short intro and the Copy / Open Marketplace buttons', async () => {
    const w = await mountPage(usageBody())
    await w.get('[data-testid="plan-usage-request-full"]').trigger('click')
    const text = w.text().replace(/\s+/g, ' ')
    expect(w.get('[data-testid="request-full-back"]').text()).toBe('← Plan and usage')
    expect(w.get('h1').text()).toBe('Request Full')
    expect(text).toContain('Copy this reason, then send it with the request option on Atlassian Marketplace. A site admin approves and buys Full.')
    expect(w.get('[data-testid="request-full-reason-text"]').text()).toContain('ENG (118 diagrams)')
    expect(w.get('[data-testid="request-full-copy"]').text()).toBe('Copy reason')
    expect(w.get('[data-testid="request-full-atlassian"]').text()).toBe('Open Marketplace')
    expect(text).not.toContain('Step 2 of 2')
    expect(text).not.toContain('We do not receive a copy')
    expect(text).not.toContain('request-to-install')
    expect(text).not.toContain('This opens the Full listing')
    await w.get('[data-testid="request-full-back"]').trigger('click')
    expect(w.find('[data-testid="plan-usage-view-locations"]').exists()).toBe(true)
  })
})
