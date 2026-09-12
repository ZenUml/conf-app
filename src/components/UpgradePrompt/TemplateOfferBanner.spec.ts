import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const track = vi.hoisted(() => vi.fn())
const createTemplate = vi.hoisted(() => vi.fn())
const close = vi.hoisted(() => vi.fn())
const bannerIdentity = vi.hoisted(() => vi.fn())

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: track }))
vi.mock('@/utils/template/createSpaceTemplate', () => ({
  createSpaceTemplate: createTemplate,
  TemplateCreateError: class TemplateCreateError extends Error {
    constructor(public readonly reason: string, message: string) {
      super(message)
    }
  },
}))
vi.mock('@/utils/template/variantApp', () => ({
  liteAppIdentity: () => ({ appId: 'app-1', macroKey: 'zenuml-sequence-macro-lite' }),
}))
vi.mock('@/utils/paywall/warningBanner', () => ({
  deriveWarningBannerIdentity: bannerIdentity,
}))
vi.mock('@/model/globals/forgeGlobal', () => ({ default: { forgeContext: { environmentId: 'env-1', environmentType: 'STAGING' } } }))
vi.mock('@forge/bridge', () => ({ view: { close } }))

import TemplateOfferBanner from './TemplateOfferBanner.vue'
import { TemplateCreateError } from '@/utils/template/createSpaceTemplate'
import forgeGlobal from '@/model/globals/forgeGlobal'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  bannerIdentity.mockReturnValue({ clientDomain: 'example-tenant', spaceKey: 'ENG' })
  ;(forgeGlobal as any).forgeContext = { environmentId: 'env-1', environmentType: 'STAGING' }
})

describe('TemplateOfferBanner', () => {
  it('records the fixed, non-tenant-specific template id after a successful create', async () => {
    // Removing the fixed ID would join tenant template IDs into analytics.
    createTemplate.mockResolvedValue(undefined)
    const wrapper = mount(TemplateOfferBanner, { props: { macroCount: 60 } })

    await wrapper.get('[data-testid="template-offer-create"]').trigger('click')
    await flushPromises()

    expect(track).toHaveBeenCalledWith('template_created', expect.objectContaining({
      feature_area: 'confluence', surface: 'page_banner', macro_type: 'sequence',
      ui_component: 'template_offer', template_id: 'sequence-space-template', macro_count: 60,
    }))
    expect(track.mock.calls.flat()[1]).not.toHaveProperty('space_key')
    expect(wrapper.text()).toContain('Template created')
    expect(wrapper.find('[data-testid="template-offer-create"]').exists()).toBe(false)
  })

  it('keeps the create control available after a forbidden response so the admin can retry', async () => {
    createTemplate
      .mockRejectedValueOnce(new TemplateCreateError('forbidden', 'not permitted'))
      .mockResolvedValueOnce(undefined)
    const wrapper = mount(TemplateOfferBanner, { props: { macroCount: 60 } })

    await wrapper.get('[data-testid="template-offer-create"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('permission to create templates')

    await wrapper.get('[data-testid="template-offer-create"]').trigger('click')
    await flushPromises()
    expect(createTemplate).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Template created')
  })

  it('records a thirty-day dismissal and closes the banner', async () => {
    const wrapper = mount(TemplateOfferBanner, { props: { macroCount: 60 } })
    await wrapper.get('[data-testid="template-offer-dismiss"]').trigger('click')
    await flushPromises()

    expect(track).toHaveBeenCalledWith('template_offer_dismissed', expect.objectContaining({
      feature_area: 'confluence', surface: 'page_banner', macro_type: 'sequence', ui_component: 'template_offer',
    }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('reports a closed context failure without calling Confluence', async () => {
    ;(forgeGlobal as any).forgeContext = undefined
    const wrapper = mount(TemplateOfferBanner, { props: { macroCount: 60 } })
    await wrapper.get('[data-testid="template-offer-create"]').trigger('click')
    await flushPromises()

    expect(createTemplate).not.toHaveBeenCalled()
    expect(track).toHaveBeenCalledWith('template_create_failed', expect.objectContaining({ failure_reason: 'context_unavailable' }))
    expect(wrapper.text()).toContain('could not confirm this page context')
  })

  it('uses the closed unexpected category for a retry after a prior forbidden failure', async () => {
    createTemplate
      .mockRejectedValueOnce(new TemplateCreateError('forbidden', 'denied'))
      .mockRejectedValueOnce(new Error('transport detail'))
    const wrapper = mount(TemplateOfferBanner, { props: { macroCount: 60 } })

    await wrapper.get('[data-testid="template-offer-create"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="template-offer-create"]').trigger('click')
    await flushPromises()

    expect(track).toHaveBeenLastCalledWith('template_create_failed', expect.objectContaining({ failure_reason: 'unexpected' }))
  })

  it('refuses a stale unknown space identity before calling the template API', async () => {
    bannerIdentity.mockReturnValue({ clientDomain: 'unknown', spaceKey: 'unknown' })
    const wrapper = mount(TemplateOfferBanner, { props: { macroCount: 60 } })
    await wrapper.get('[data-testid="template-offer-create"]').trigger('click')
    await flushPromises()

    expect(createTemplate).not.toHaveBeenCalled()
    expect(track).toHaveBeenCalledWith('template_create_failed', expect.objectContaining({ failure_reason: 'context_unavailable' }))
  })
})
