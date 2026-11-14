import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import EditorMcpPromo from './EditorMcpPromo.vue'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {},
  getContext: vi.fn(() => Promise.resolve({ cloudId: 'cloud-1', accountId: 'acct-1' })),
}))

const card = (w: ReturnType<typeof mount>) => w.find('[data-testid="mcp-promo-card"]')

describe('EditorMcpPromo', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.mocked(trackAnalyticsEvent).mockClear()
  })

  it.each([
    ['graph', 'onto the canvas'],
    ['OpenAPI', 'paste it here'],
    ['AsyncAPI', 'paste it here'],
  ])('shows the new-diagram card for a new %s diagram until the author edits it', async (type, bodyText) => {
    const w = mount(EditorMcpPromo, { props: { diagramType: type, code: 'starter' }, attachTo: document.body })
    await flushPromises()
    expect(card(w).exists()).toBe(true)
    expect(card(w).text()).toContain('Start from your code')
    expect(card(w).text()).toContain(bodyText)
    expect(vi.mocked(trackAnalyticsEvent).mock.calls).toContainEqual([
      'agent_link_mcp_button_shown',
      expect.objectContaining({ macro_type: type, mcp_button_placement: 'editor_new_diagram' }),
    ])

    await w.setProps({ code: 'starter, now edited' })
    expect(card(w).exists()).toBe(false)
    w.unmount()
  })

  it('shows no new-diagram card for a saved diagram', async () => {
    const w = mount(EditorMcpPromo, { props: { diagramType: 'graph', code: '<x/>', diagramId: '42' } })
    await flushPromises()
    expect(card(w).exists()).toBe(false)
  })

  it('opens Connect MCP with a draft prompt in the diagram\'s language', async () => {
    const w = mount(EditorMcpPromo, { props: { diagramType: 'AsyncAPI', code: 'asyncapi: 3.0.0' }, attachTo: document.body })
    await flushPromises()
    await w.find('[data-testid="mcp-promo-card-cta"]').trigger('click')
    expect(card(w).exists()).toBe(false)
    expect(document.body.textContent).toContain('help me draw an AsyncAPI diagram')
    w.unmount()
  })
})
