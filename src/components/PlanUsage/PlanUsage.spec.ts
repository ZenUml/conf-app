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

  it('shows the count note on every load and the "more than a day old" wording only when stale', async () => {
    const fresh = await mountPage(usageBody())
    expect(fresh.get('[data-testid="plan-usage-count-note"]').text()).toContain('Reported counts may be a few hours old')
    expect(fresh.get('[data-testid="plan-usage-count-note"]').text()).toContain('may not match this total')
    const stale = await mountPage(usageBody({ isStale: true }))
    expect(stale.get('[data-testid="plan-usage-count-note"]').text()).toContain('more than a day old')
  })
})
