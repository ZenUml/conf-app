// BEFORE/AFTER probe: the same response body into the base branch's footer and the
// candidate's; prints the properties of related_diagrams_lookup_failed and the rendered HTML.
import { flushPromises, mount } from '@vue/test-utils'
import { it, vi } from 'vitest'

const { related, trackAnalyticsEvent } = vi.hoisted(() => ({
  related: { value: null as any },
  trackAnalyticsEvent: vi.fn(),
}))
vi.mock('@/services/ArchitectureTokens', () => ({
  getRelatedDiagrams: vi.fn(async () => related.value),
  RelatedLookupError: class extends Error {},
}))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent }))
vi.mock('@/utils/renderGate/maybeGateViewerRender', () => ({ getGateTelemetry: () => ({}) }))
vi.mock('@/model/globals/forgeGlobal', () => ({
  openUrl: vi.fn(),
  default: { forgeContext: { siteUrl: 'https://example.atlassian.net', extension: { space: { key: 'OP' } } } },
}))

import Before from './RelatedDiagramsFooter.base.vue'
import After from './RelatedDiagramsFooter.vue'

const base = { indexedAt: '2026-08-27T05:00:00Z', contentVersion: 3, participants: [] }
const bodies: Record<string, any> = {
  version_mismatch: { ...base, error_kind: 'stale_index', stale_reason: 'version_mismatch', live_version: 4 },
  not_in_live_read: { ...base, error_kind: 'stale_index', stale_reason: 'not_in_live_read' },
  no_page_container: { ...base, error_kind: 'stale_index', stale_reason: 'no_page_container' },
  'stale_index from an older backend': { ...base, error_kind: 'stale_index' },
  confluence_unavailable: { ...base, error_kind: 'confluence_unavailable' },
}

it('prints the event properties and DOM for each body', async () => {
  const out: Record<string, unknown> = {}
  for (const [name, body] of Object.entries(bodies)) {
    const run = async (component: any) => {
      trackAnalyticsEvent.mockClear()
      related.value = body
      const host = document.createElement('div')
      const wrapper = mount(component, {
        props: { customContentId: '1', ready: true, enabled: true, surface: 'viewer', macroType: 'sequence', svgHost: () => host },
      })
      await flushPromises()
      const call = trackAnalyticsEvent.mock.calls.find(([event]) => event === 'related_diagrams_lookup_failed')
      const { duration_ms: _d, ...properties } = (call?.[1] ?? {}) as Record<string, unknown>
      const html = wrapper.html()
      wrapper.unmount()
      return { events: trackAnalyticsEvent.mock.calls.map(([event]) => event), properties, html }
    }
    out[name] = { BEFORE: await run(Before), AFTER: await run(After) }
  }
  console.log('PROBE_JSON ' + JSON.stringify(out, null, 2))
})
