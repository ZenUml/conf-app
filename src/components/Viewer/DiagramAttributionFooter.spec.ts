import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DiagramAttributionFooter from './DiagramAttributionFooter.vue'

const impact = { audienceCount: 0 }

vi.mock('@/utils/requestUtil', () => ({
  forgeRequest: vi.fn(async () => ({ displayName: 'Peng' })),
}))

vi.mock('@/services/DiagramImpact', () => ({
  getDiagramImpact: vi.fn(async () => ({
    audienceCount: impact.audienceCount,
    viewerRelation: 'viewer',
  })),
  registerDiagramImpactView: vi.fn(),
}))

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

async function renderFooter() {
  const wrapper = mount(DiagramAttributionFooter, {
    props: {
      attribution: { customContentId: 'content-1', createdByAccountId: 'account-1' },
      macroType: 'sequence',
      ready: false,
    },
  })
  await flushPromises()
  return wrapper
}

describe('DiagramAttributionFooter view count', () => {
  beforeEach(() => {
    impact.audienceCount = 0
  })

  it('hides the view metric when nobody else has viewed the diagram', async () => {
    const wrapper = await renderFooter()

    expect(wrapper.text()).toBe('Created by Peng')
  })

  it('shows one qualifying viewer as a neutral view count', async () => {
    impact.audienceCount = 1

    const wrapper = await renderFooter()

    expect(wrapper.text().replace(/\s+/g, ' ').trim()).toBe('Created by Peng · 1 view')
  })

  it('shows the exact plural view count', async () => {
    impact.audienceCount = 5

    const wrapper = await renderFooter()

    expect(wrapper.text().replace(/\s+/g, ' ').trim()).toBe('Created by Peng · 5 views')
  })
})
