import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PaywallWarningBanner from './PaywallWarningBanner.vue'

const warningMarker = {
  severity: 'critical',
  macroCount: 101,
  spacePaid: false,
  customerSuccessServiceEnabled: true,
  updatedAt: 'x',
}

// Mutable gate result the marker-module mock returns; flipped per test.
const gate = { visible: true, targeting: warningMarker as any }

vi.mock('@/utils/paywall/warningBanner', () => ({
  deriveWarningBannerIdentity: () => ({ clientDomain: 'example-tenant', spaceKey: 'ENG' }),
  readTargetingMarker: () => gate.targeting,
  readMacroActivityMarker: () => ({ lastActivityAt: '2026-06-03T00:00:00.000Z', activityType: 'edit' }),
  readDismissalMarker: () => null,
  isWarningBannerVisible: () => gate.visible,
  recordBannerShown: vi.fn(),
  recordBannerDismissed: vi.fn(),
}))

const closeView = vi.fn()

vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: {
    PAYWALL_BANNER_SHOWN: 'paywall_banner_shown',
    PAYWALL_BANNER_DISMISSED: 'paywall_banner_dismissed',
    ADVOCACY_MESSAGE_COPIED: 'advocacy_message_copied',
    EXTENSION_REQUEST_CLICKED: 'extension_request_clicked',
  },
}))

vi.mock('@/composables/useCustomerSuccessService', () => ({
  // The component only reads `.value` on these (pure URL refs), so plain
  // { value } stand-ins suffice — no need to import vue's ref into the factory.
  useCustomerSuccessService: () => ({
    upgradeUrl: { value: 'https://upgrade.example.com' },
    enterpriseBundleUrl: { value: 'https://bundle.example.com' },
  }),
  MACROS_LIMIT: 100,
}))

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: null },
  getView: vi.fn(() => Promise.resolve({ close: closeView })),
  openUrl: vi.fn(),
}))

describe('PaywallWarningBanner (page banner)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gate.visible = true
    gate.targeting = warningMarker
  })

  it('renders and records an impression when the gate passes', async () => {
    const { recordBannerShown } = await import('@/utils/paywall/warningBanner')
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const wrapper = mount(PaywallWarningBanner)

    expect(wrapper.find('[data-testid="paywall-warning-banner"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('101 of 100')
    expect(recordBannerShown).toHaveBeenCalledOnce()
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_banner_shown',
      expect.objectContaining({ surface: 'page_banner', severity: 'critical', macro_count: 101 })
    )
  })

  it('closes the iframe and renders nothing when the gate fails', async () => {
    gate.visible = false
    const { recordBannerShown } = await import('@/utils/paywall/warningBanner')
    const wrapper = mount(PaywallWarningBanner)

    expect(wrapper.find('[data-testid="paywall-warning-banner"]').exists()).toBe(false)
    await vi.waitFor(() => expect(closeView).toHaveBeenCalledOnce())
    expect(recordBannerShown).not.toHaveBeenCalled()
  })

  it('snoozes (records dismissal) and closes on dismiss', async () => {
    const { recordBannerDismissed } = await import('@/utils/paywall/warningBanner')
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const wrapper = mount(PaywallWarningBanner)

    await wrapper.find('[data-testid="paywall-banner-dismiss"]').trigger('click')

    expect(recordBannerDismissed).toHaveBeenCalledOnce()
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_banner_dismissed',
      expect.objectContaining({ surface: 'page_banner' })
    )
    await vi.waitFor(() => expect(closeView).toHaveBeenCalled())
    expect(wrapper.find('[data-testid="paywall-warning-banner"]').exists()).toBe(false)
  })
})
