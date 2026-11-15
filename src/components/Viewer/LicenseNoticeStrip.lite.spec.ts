import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import LicenseNoticeStrip from './LicenseNoticeStrip.vue'
import LicenseWatermark from './LicenseWatermark.vue'
import { navigateToAppPage, openUrl } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

vi.mock('@/model/globals/forgeGlobal', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
  navigateToAppPage: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

const liteProps = { surface: 'viewer', macroType: 'mermaid', basis: 'site_policy_limit_reached', count: 2282, limit: 100, stage: 'watermark' } as const
const analytics = { feature_area: 'license_notice', surface: 'viewer', macro_type: 'mermaid', license_notice_basis: 'site_policy_limit_reached', enforcement_stage: 'watermark', macro_count: 2282 }

describe('LicenseNoticeStrip, Lite site-policy variant', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    [2282, '2,282'],
    [150, '150'],
  ])('shows the Lite copy with count %i as %s', (count, label) => {
    const wrapper = mount(LicenseNoticeStrip, { props: { ...liteProps, count } })
    expect(wrapper.get('.license-notice-title').text()).toBe('Lite diagram limit reached')
    expect(wrapper.get('.license-notice-body').text()).toBe(
      `This diagram stays viewable. This space has ${label} diagrams and Lite covers 100 per space. Ask your Confluence admin to upgrade to Full to remove the watermark.`,
    )
  })

  it('has no Marketplace button and opens Plan and usage with a tracked click', async () => {
    const wrapper = mount(LicenseNoticeStrip, { props: liteProps })
    expect(wrapper.find('[data-testid="license-notice-upgrade"]').exists()).toBe(false)
    const button = wrapper.get('[data-testid="license-notice-plan-usage"]')
    expect(button.text()).toBe('View plan and usage')
    await button.trigger('click')
    expect(navigateToAppPage).toHaveBeenCalledWith('zenuml-plan-usage')
    expect(openUrl).not.toHaveBeenCalled()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('license_notice_plan_usage_clicked', analytics)
  })

  it('keeps the help line and tags it with the enforcement stage', async () => {
    const wrapper = mount(LicenseNoticeStrip, { props: liteProps })
    expect(wrapper.get('.license-notice-help').text()).toContain("Can't upgrade?")
    await wrapper.get('[data-testid="license-notice-ticket"]').trigger('click')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('license_notice_ticket_clicked', analytics)
  })
})

describe('LicenseWatermark text', () => {
  it('defaults to the Full text', () => {
    const text = mount(LicenseWatermark).findAll('text').map(t => t.text())
    expect(text).toEqual(['NO ACTIVE LICENSE', 'Payment required · Ask your Confluence admin to subscribe to Full'])
  })

  it('renders the headline and detail it is given', () => {
    const text = mount(LicenseWatermark, {
      props: { headline: 'UPGRADE REQUIRED', detail: '2,282 of 100 Lite diagrams in this space · Ask your Confluence admin to upgrade' },
    }).findAll('text').map(t => t.text())
    expect(text).toEqual(['UPGRADE REQUIRED', '2,282 of 100 Lite diagrams in this space · Ask your Confluence admin to upgrade'])
  })
})
