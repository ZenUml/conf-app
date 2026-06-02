import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PaywallWarningBanner from './PaywallWarningBanner.vue'

vi.mock('@/composables/useCustomerSuccessService', () => {
  const { ref, computed } = require('vue')
  const macrosCreated = ref(90)
  const cssEnabled = ref(true)
  const spacePaid = ref(false)
  const isLite = ref(true)

  const actionRequired = computed(
    () => isLite.value && !spacePaid.value && macrosCreated.value >= 85 && cssEnabled.value
  )
  const shouldBlockActions = computed(
    () => isLite.value && !spacePaid.value && macrosCreated.value >= 100 && cssEnabled.value
  )
  const severity = computed(() => {
    if (macrosCreated.value >= 100) return 'critical'
    if (macrosCreated.value >= 85) return 'warning'
    return 'normal'
  })

  return {
    useCustomerSuccessService: () => ({
      macrosCreated,
      actionRequired,
      shouldBlockActions,
      severity,
      spaceKey: ref('TEST'),
      upgradeUrl: ref('https://upgrade.example.com'),
      enterpriseBundleUrl: ref('https://bundle.example.com'),
      spacePaid,
    }),
    getUpgradeContext: () => ({ macro_count: macrosCreated.value, macro_limit: 100, space_key: 'TEST', macro_usage_pct: 90 }),
    MACROS_LIMIT: 100,
    __mocks: { macrosCreated, cssEnabled, spacePaid, isLite },
  }
})

vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: {
    PAYWALL_BANNER_SHOWN: 'paywall_banner_shown',
    PAYWALL_BANNER_DISMISSED: 'paywall_banner_dismissed',
    ADVOCACY_MESSAGE_COPIED: 'advocacy_message_copied',
    EXTENSION_REQUEST_CLICKED: 'extension_request_clicked',
  },
  UIComponent: { BANNER: 'banner' },
}))

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: null },
  openUrl: vi.fn(),
}))

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: vi.fn().mockReturnValue('test-domain'),
}))

describe('PaywallWarningBanner', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows banner when actionRequired and severity is warning', () => {
    const wrapper = mount(PaywallWarningBanner)
    expect(wrapper.find('[data-testid="paywall-warning-banner"]').exists()).toBe(true)
  })

  it('hides banner after dismiss click', async () => {
    const wrapper = mount(PaywallWarningBanner)
    await wrapper.find('[data-testid="paywall-banner-dismiss"]').trigger('click')
    expect(wrapper.find('[data-testid="paywall-warning-banner"]').exists()).toBe(false)
  })

  it('tracks paywall_banner_shown on mount when visible', async () => {
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    mount(PaywallWarningBanner)
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_banner_shown',
      expect.objectContaining({ ui_component: 'banner', severity: 'warning' })
    )
  })

  it('tracks paywall_banner_dismissed on dismiss', async () => {
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const wrapper = mount(PaywallWarningBanner)
    await wrapper.find('[data-testid="paywall-banner-dismiss"]').trigger('click')
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_banner_dismissed',
      expect.objectContaining({ ui_component: 'banner' })
    )
  })

  it('does not show banner when severity is critical (>=100 macros)', async () => {
    const mod = await import('@/composables/useCustomerSuccessService') as any
    mod.__mocks.macrosCreated.value = 105
    const wrapper = mount(PaywallWarningBanner)
    expect(wrapper.find('[data-testid="paywall-warning-banner"]').exists()).toBe(false)
    mod.__mocks.macrosCreated.value = 90
  })

  it('does not show banner when actionRequired is false', async () => {
    const mod = await import('@/composables/useCustomerSuccessService') as any
    mod.__mocks.cssEnabled.value = false
    const wrapper = mount(PaywallWarningBanner)
    expect(wrapper.find('[data-testid="paywall-warning-banner"]').exists()).toBe(false)
    mod.__mocks.cssEnabled.value = true
  })
})
