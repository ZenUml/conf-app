import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PaywallWarningBanner from './PaywallWarningBanner.vue'

const warningMarker = { severity: 'warning', macroCount: 90, spacePaid: false, updatedAt: 'x' }

// Mutable gate result the marker-module mock returns; flipped per test.
const gate = { visible: true, targeting: warningMarker as any }

vi.mock('@/utils/paywall/warningBanner', () => ({
  deriveWarningBannerIdentity: () => ({ clientDomain: 'example-tenant', spaceKey: 'ENG' }),
  readTargetingMarker: () => gate.targeting,
  readDismissalMarker: () => null,
  isWarningBannerVisible: () => gate.visible,
  recordBannerShown: vi.fn(),
  recordBannerDismissed: vi.fn(),
}))

vi.mock('@forge/bridge', () => ({ view: { close: vi.fn() } }))

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
    expect(wrapper.text()).toContain('90 of 100')
    expect(recordBannerShown).toHaveBeenCalledOnce()
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_banner_shown',
      expect.objectContaining({ surface: 'page_banner', severity: 'warning', macro_count: 90 })
    )
  })

  it('closes the iframe and renders nothing when the gate fails', async () => {
    gate.visible = false
    const { view } = await import('@forge/bridge')
    const { recordBannerShown } = await import('@/utils/paywall/warningBanner')
    const wrapper = mount(PaywallWarningBanner)

    expect(wrapper.find('[data-testid="paywall-warning-banner"]').exists()).toBe(false)
    expect(view.close).toHaveBeenCalledOnce()
    expect(recordBannerShown).not.toHaveBeenCalled()
  })

  it('snoozes (records dismissal) and closes on dismiss', async () => {
    const { recordBannerDismissed } = await import('@/utils/paywall/warningBanner')
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const { view } = await import('@forge/bridge')
    const wrapper = mount(PaywallWarningBanner)

    await wrapper.find('[data-testid="paywall-banner-dismiss"]').trigger('click')

    expect(recordBannerDismissed).toHaveBeenCalledOnce()
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_banner_dismissed',
      expect.objectContaining({ surface: 'page_banner' })
    )
    expect(view.close).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="paywall-warning-banner"]').exists()).toBe(false)
  })
})
