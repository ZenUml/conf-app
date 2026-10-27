import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PlanUsage from './PlanUsage.vue'
import { getFullscreenRecovery, requestFullscreenRecovery, activateFullscreenRecovery } from '@/apis/fullscreenRecovery'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
  getSpaceKey: () => 'ENG',
}))
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { zenumlRemoteBaseUrl: 'https://api.example.test', forgeContext: undefined, isForge: true },
  openUrl: vi.fn(),
}))
vi.mock('@/apis/fullscreenRecovery', () => ({
  getFullscreenRecovery: vi.fn(), requestFullscreenRecovery: vi.fn(), activateFullscreenRecovery: vi.fn(),
}))
vi.mock('@forge/bridge', () => ({ router: { navigate: vi.fn() } }))
import forgeGlobal from '@/model/globals/forgeGlobal'
import { router } from '@forge/bridge'

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
    forgeGlobal.forgeContext = undefined
  })

  it('uses the viewer snapshot, not the query request id, and writes a Fullscreen reason', async () => {
    forgeGlobal.forgeContext = { extension: { location: 'https://example.atlassian.net/wiki/apps/app/env/zenuml-plan-usage?source=fullscreen_recovery&space_key=ENG&request=foreign-id&scenes=present&page_id=123' } }
    vi.mocked(getFullscreenRecovery).mockResolvedValue({
      state: 'expired', serverNow: '2026-10-24T00:00:00Z', policyVersion: 'fullscreen-contact-v1',
      request: { id: 'own-id', scenarios: ['discuss'], note: '', email: 'reader@example.com', createdAt: '2026-10-01T00:00:00Z', mailState: 'queued' },
      grant: { id: 'grant', activatedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-08T00:00:00Z' },
    })
    const w = await mountPage(usageBody())
    expect(w.get('[data-testid="plan-usage-fullscreen-context"]').text()).toContain('Discuss it with colleagues')
    expect(w.get('[data-testid="plan-usage-fullscreen-context"]').text()).not.toContain('foreign-id')
    await w.get('[data-testid="plan-usage-request-full"]').trigger('click')
    expect(w.get('[data-testid="request-full-reason-text"]').text()).toContain('Discuss it with colleagues')
    expect(w.get('[data-testid="request-full-reason-text"]').text()).not.toContain('creating and editing')
    expect(w.get('[data-testid="request-full-reason-text"]').text()).not.toContain('foreign-id')
  })

  it('seeds the contact form with allowed scenes and returns to the source page without activating', async () => {
    forgeGlobal.forgeContext = { extension: { location: 'https://example.atlassian.net/wiki/apps/app/env/zenuml-plan-usage?source=fullscreen_recovery&space_key=ENG&scenes=present,arbitrary&page_id=123' } }
    vi.mocked(getFullscreenRecovery).mockResolvedValue({ state: 'not_requested', serverNow: '2026-10-24T00:00:00Z', policyVersion: 'fullscreen-contact-v1' })
    vi.mocked(requestFullscreenRecovery).mockResolvedValue({ snapshot: {
      state: 'pending_activation', serverNow: '2026-10-24T00:00:00Z', policyVersion: 'fullscreen-contact-v1',
      request: { id: 'own-id', scenarios: ['present'], note: '', email: 'reader@example.com', createdAt: '2026-10-24T00:00:00Z' },
      grant: { id: 'grant', activatedAt: null, expiresAt: null },
    } })
    const w = await mountPage(usageBody())
    await w.get('[data-testid="plan-usage-fullscreen-request"]').trigger('click')
    expect((w.get('input[value="present"]').element as HTMLInputElement).checked).toBe(true)
    expect((w.get('input[value="other"]').element as HTMLInputElement).checked).toBe(false)
    await w.get('button.recovery__primary').trigger('click')
    await w.get('input[type="email"]').setValue('reader@example.com')
    await w.get('input[type="checkbox"][required]').setValue(true)
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(requestFullscreenRecovery).toHaveBeenCalledWith(expect.objectContaining({ spaceKey: 'ENG' }))
    expect(w.text()).toContain('Your 7 days have not started')
    expect(requestFullscreenRecovery).toHaveBeenCalledWith(expect.objectContaining({ contentId: '123' }))
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('fullscreen_recovery_request_submitted', expect.objectContaining({ surface: 'dashboard', scenario_codes: ['present'] }))
    await w.get('button.recovery__primary').trigger('click')
    await flushPromises()
    expect(vi.mocked(router.navigate)).toHaveBeenCalledWith('/wiki/pages/viewpage.action?pageId=123')
    expect(activateFullscreenRecovery).not.toHaveBeenCalled()
  })

  it('keeps ordinary space access separate from an old expired site-user grant', async () => {
    forgeGlobal.forgeContext = { extension: { location: 'https://example.atlassian.net/wiki/apps/app/env/zenuml-plan-usage?source=fullscreen_recovery&space_key=SMALL&page_id=123' } }
    vi.mocked(getFullscreenRecovery).mockResolvedValue({
      state: 'disabled', serverNow: '2026-10-24T00:00:00Z', policyVersion: 'fullscreen-contact-v1',
      request: { id: 'old', scenarios: ['present'], email: 'reader@example.com', note: '', createdAt: '2026-10-01T00:00:00Z' },
      grant: { id: 'old-grant', activatedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-08T00:00:00Z' },
    })
    const w = await mountPage(usageBody({ overLimitSpaces: [], totalMacros: 99 }))
    expect(getFullscreenRecovery).toHaveBeenCalledWith('SMALL')
    const context = w.get('[data-testid="plan-usage-fullscreen-context"]')
    expect(context.text()).toContain('does not need temporary Fullscreen access')
    expect(context.text()).not.toContain('ended')
    expect(w.find('[data-testid="plan-usage-fullscreen-request"]').exists()).toBe(false)
    expect(requestFullscreenRecovery).not.toHaveBeenCalled()
    expect(activateFullscreenRecovery).not.toHaveBeenCalled()
  })

  it('does not offer a new request without source-space evidence', async () => {
    forgeGlobal.forgeContext = { extension: { location: 'https://example.atlassian.net/wiki/apps/app/env/zenuml-plan-usage?source=fullscreen_recovery' } }
    const w = await mountPage(usageBody())
    expect(getFullscreenRecovery).not.toHaveBeenCalled()
    expect(w.find('[data-testid="plan-usage-fullscreen-request"]').exists()).toBe(false)
    expect(requestFullscreenRecovery).not.toHaveBeenCalled()
  })

  it('shows retry when the recovery API returns unavailable', async () => {
    forgeGlobal.forgeContext = { extension: { location: 'https://example.atlassian.net/wiki/apps/app/env/zenuml-plan-usage?source=fullscreen_recovery&space_key=ENG' } }
    vi.mocked(getFullscreenRecovery).mockResolvedValue({ state: 'unavailable', serverNow: '2026-10-24T00:00:00Z', policyVersion: 'fullscreen-contact-v1' })
    const w = await mountPage(usageBody())
    expect(w.get('[data-testid="plan-usage-fullscreen-context"] [role="alert"]').text()).toContain('could not check')
    expect(w.find('[data-testid="plan-usage-fullscreen-request"]').exists()).toBe(false)
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
