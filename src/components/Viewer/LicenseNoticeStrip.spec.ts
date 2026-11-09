import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import LicenseNoticeStrip from './LicenseNoticeStrip.vue'
import { openUrl } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

vi.mock('@/model/globals/forgeGlobal', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

const expectedProps = { feature_area: 'license_notice', surface: 'viewer', macro_type: 'mermaid' }

function mountStrip() {
  return mount(LicenseNoticeStrip, { props: { surface: 'viewer', macroType: 'mermaid' } })
}

describe('LicenseNoticeStrip', () => {
  const writeText = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })
  afterEach(() => vi.useRealTimers())

  it('is a status region titled "No active license" that says the diagram stays viewable', () => {
    const wrapper = mountStrip()
    const root = wrapper.get('[data-testid="license-notice-strip"]')
    expect(root.attributes('role')).toBe('status')
    expect(wrapper.get('.license-notice-title').text()).toBe('No active license')
    expect(wrapper.get('.license-notice-body').text()).toContain('This diagram stays viewable')
  })

  it('opens Marketplace from the upgrade button and tracks the click', async () => {
    await mountStrip().get('[data-testid="license-notice-upgrade"]').trigger('click')
    expect(openUrl).toHaveBeenCalledWith(expect.stringContaining('marketplace.atlassian.com'))
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('license_notice_upgrade_clicked', expectedProps)
  })

  it('never renders a mailto link, because the Forge sandbox cannot open one', () => {
    const wrapper = mountStrip()
    expect(wrapper.get('[data-testid="license-notice-email"]').text()).toBe('support@zenuml.com')
    expect(wrapper.find('a[href^="mailto:"]').exists()).toBe(false)
  })

  it('copies the support address on click, shows "Copied" briefly, and tracks it', async () => {
    vi.useFakeTimers()
    const wrapper = mountStrip()
    const email = wrapper.get('[data-testid="license-notice-email"]')
    await email.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('support@zenuml.com')
    expect(email.attributes('data-copied')).toBeDefined()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('license_notice_email_copied', expectedProps)
    vi.advanceTimersByTime(1500)
    await wrapper.vm.$nextTick()
    expect(email.attributes('data-copied')).toBeUndefined()
  })

  it('opens the support portal and tracks the ticket click', async () => {
    await mountStrip().get('[data-testid="license-notice-ticket"]').trigger('click')
    expect(openUrl).toHaveBeenCalledWith('https://zenuml.atlassian.net/servicedesk/customer/portal/1/group/1/create/1')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('license_notice_ticket_clicked', expectedProps)
  })
})
