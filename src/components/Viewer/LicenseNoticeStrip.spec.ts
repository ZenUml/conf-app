import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import LicenseNoticeStrip from './LicenseNoticeStrip.vue'
import { openUrl } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

vi.mock('@/model/globals/forgeGlobal', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

const expectedProps = { feature_area: 'license_notice', surface: 'viewer', macro_type: 'mermaid' }

function mountStrip() {
  return mount(LicenseNoticeStrip, { props: { surface: 'viewer', macroType: 'mermaid' } })
}

describe('LicenseNoticeStrip support fallbacks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the support address as readable text with a mailto link', () => {
    const email = mountStrip().get('[data-testid="license-notice-email"]')
    expect(email.text()).toBe('support@zenuml.com')
    expect(email.attributes('href')).toBe('mailto:support@zenuml.com')
  })

  it('tracks the email click', async () => {
    await mountStrip().get('[data-testid="license-notice-email"]').trigger('click')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('license_notice_email_clicked', expectedProps)
  })

  it('opens the support portal and tracks the ticket click', async () => {
    await mountStrip().get('[data-testid="license-notice-ticket"]').trigger('click')
    expect(openUrl).toHaveBeenCalledWith('https://zenuml.atlassian.net/servicedesk/customer/portal/1/group/1/create/1')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('license_notice_ticket_clicked', expectedProps)
  })
})
