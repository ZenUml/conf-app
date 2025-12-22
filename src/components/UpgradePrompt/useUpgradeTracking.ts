import { ref, watch } from 'vue'
import { trackUpgradeEvent, UpgradeEventName, ProductOption, UIComponent } from '@/utils/upgradeTracking'
import { getUpgradeContext } from '@/composables/useCustomerSuccessService'

export function useUpgradeTracking(
  visible: () => boolean,
  confluenceUsers: () => number,
  marketplaceAnnualCost: () => number,
  onClose: () => void
) {
  const modalShownTime = ref<number>(0)
  const sliderInteractionCount = ref<number>(0)
  const sliderInteracted = ref<boolean>(false)
  let sliderTrackingTimeout: ReturnType<typeof setTimeout> | null = null

  // Track when modal is shown
  watch(visible, (newVisible) => {
    if (newVisible) {
      modalShownTime.value = Date.now()
      trackUpgradeEvent(UpgradeEventName.MODAL_SHOWN, {
        trigger_source: 'header_badge',
        ...getUpgradeContext(),
      })
    }
  })

  // Handle slider interaction tracking (debounced)
  const trackSliderChange = () => {
    sliderInteracted.value = true
    sliderInteractionCount.value++

    // Debounced tracking (only fire after 1s of no changes)
    if (sliderTrackingTimeout) {
      clearTimeout(sliderTrackingTimeout)
    }
    sliderTrackingTimeout = setTimeout(() => {
      trackUpgradeEvent(UpgradeEventName.SLIDER_CHANGED, {
        confluence_users: confluenceUsers(),
        marketplace_cost: marketplaceAnnualCost(),
        interaction_count: sliderInteractionCount.value,
        ...getUpgradeContext(),
      })
    }, 1000)
  }

  // Handle modal close/dismiss
  const handleClose = () => {
    const timeSpent = Date.now() - modalShownTime.value
    trackUpgradeEvent(UpgradeEventName.MODAL_DISMISSED, {
      slider_interacted: sliderInteracted.value,
      time_spent: Math.round(timeSpent / 1000),
      confluence_users: confluenceUsers(),
      interaction_count: sliderInteractionCount.value,
      ...getUpgradeContext(),
    })

    // Reset tracking state
    sliderInteracted.value = false
    sliderInteractionCount.value = 0

    onClose()
  }

  // Track marketplace CTA click
  const trackMarketplaceClick = () => {
    const timeToDecision = Date.now() - modalShownTime.value
    trackUpgradeEvent(UpgradeEventName.CTA_CLICKED, {
      product_option: ProductOption.MARKETPLACE,
      ui_component: UIComponent.TOOLTIP,
      cta_position: 'primary',
      confluence_users: confluenceUsers(),
      marketplace_cost: marketplaceAnnualCost(),
      interaction_count: sliderInteractionCount.value,
      time_to_decision: Math.round(timeToDecision / 1000),
      ...getUpgradeContext(),
    })
    onClose()
  }

  // Track enterprise bundle CTA click
  const trackEnterpriseBundleClick = () => {
    const timeToDecision = Date.now() - modalShownTime.value
    trackUpgradeEvent(UpgradeEventName.CTA_CLICKED, {
      product_option: ProductOption.ENTERPRISE_BUNDLE,
      ui_component: UIComponent.TOOLTIP,
      cta_position: 'secondary',
      confluence_users: confluenceUsers(),
      marketplace_cost: marketplaceAnnualCost(),
      interaction_count: sliderInteractionCount.value,
      time_to_decision: Math.round(timeToDecision / 1000),
      ...getUpgradeContext(),
    })
    onClose()
  }

  return {
    trackSliderChange,
    handleClose,
    trackMarketplaceClick,
    trackEnterpriseBundleClick,
  }
}
