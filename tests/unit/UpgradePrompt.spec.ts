import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: {
    MODAL_SHOWN: 'upgrade_modal_shown',
    CTA_CLICKED: 'upgrade_cta_clicked',
    MODAL_DISMISSED: 'upgrade_modal_dismissed',
    SLIDER_CHANGED: 'upgrade_slider_changed',
  },
  ProductOption: {
    MARKETPLACE: 'marketplace',
    ENTERPRISE_BUNDLE: 'enterprise_bundle',
  },
  UIComponent: {
    TOOLTIP: 'tooltip',
  },
}))

vi.mock('@/composables/useCustomerSuccessService', () => ({
  getUpgradeContext: () => ({
    macro_count: 100,
    macro_limit: 100,
    macro_usage_pct: 100,
  }),
}))

vi.mock('@/model/globals/forgeGlobal', () => ({
  openUrl: vi.fn(),
}))

import UpgradePrompt from '@/components/UpgradePrompt/UpgradePrompt.vue'
import { trackUpgradeEvent } from '@/utils/upgradeTracking'
import { openUrl } from '@/model/globals/forgeGlobal'

const baseProps = {
  visible: true,
  macrosCreated: 100,
  macrosLimit: 100,
  upgradeUrl: 'https://marketplace.example/upgrade',
  enterpriseBundleUrl: 'https://stripe.example/bundle',
}

describe('UpgradePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    ;(openUrl as any).mockResolvedValue(undefined)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('tracks upgrade_modal_shown when mounted already visible', () => {
    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'upgrade_modal_shown',
      expect.objectContaining({
        trigger_source: 'header_badge',
        macro_count: 100,
      })
    )

    wrapper.unmount()
  })

  it('tracks marketplace CTA clicks with product_option=marketplace', async () => {
    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    const marketplaceButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Upgrade →')
    ) as HTMLButtonElement | undefined

    expect(marketplaceButton).toBeTruthy()
    marketplaceButton?.click()
    await Promise.resolve()

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'upgrade_cta_clicked',
      expect.objectContaining({
        product_option: 'marketplace',
        cta_position: 'primary',
        ui_component: 'tooltip',
      })
    )
    expect(openUrl).toHaveBeenCalledWith(baseProps.upgradeUrl)

    wrapper.unmount()
  })

  it('tracks enterprise CTA clicks with product_option=enterprise_bundle', async () => {
    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    const enterpriseButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Get Bundle →')
    ) as HTMLButtonElement | undefined

    expect(enterpriseButton).toBeTruthy()
    enterpriseButton?.click()
    await Promise.resolve()

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'upgrade_cta_clicked',
      expect.objectContaining({
        product_option: 'enterprise_bundle',
        cta_position: 'secondary',
        ui_component: 'tooltip',
      })
    )
    expect(openUrl).toHaveBeenCalledWith(baseProps.enterpriseBundleUrl)

    wrapper.unmount()
  })
})
