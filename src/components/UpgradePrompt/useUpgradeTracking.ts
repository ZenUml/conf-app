import { ref, watch } from 'vue'
import { trackUpgradeEvent, UpgradeEventName, UIComponent } from '@/utils/upgradeTracking'
import { getUpgradeContext } from '@/composables/useCustomerSuccessService'

export function useUpgradeTracking(visible: () => boolean, onClose: () => void) {
  const modalShownTime = ref<number>(0)

  watch(visible, (newVisible) => {
    if (newVisible) {
      modalShownTime.value = Date.now()
      trackUpgradeEvent(UpgradeEventName.MODAL_SHOWN, {
        trigger_source: 'header_badge',
        ...getUpgradeContext(),
      })
    }
  }, { immediate: true })

  const handleClose = () => {
    const timeSpent = Date.now() - modalShownTime.value
    trackUpgradeEvent(UpgradeEventName.MODAL_DISMISSED, {
      time_spent: Math.round(timeSpent / 1000),
      ...getUpgradeContext(),
    })
    onClose()
  }

  const trackAdvocacyCopy = () => {
    const timeToDecision = Date.now() - modalShownTime.value
    trackUpgradeEvent(UpgradeEventName.ADVOCACY_MESSAGE_COPIED, {
      ui_component: UIComponent.MODAL,
      time_to_decision: Math.round(timeToDecision / 1000),
      ...getUpgradeContext(),
    })
  }

  /** User toggled the collapsible advocacy draft preview in the paywall modal. */
  const trackAdvocacyDraftPreviewToggle = (expanded: boolean) => {
    const timeToDecision = Date.now() - modalShownTime.value
    trackUpgradeEvent(UpgradeEventName.ADVOCACY_DRAFT_PREVIEW_CLICKED, {
      ui_component: UIComponent.MODAL,
      expanded,
      time_to_decision: Math.round(timeToDecision / 1000),
      ...getUpgradeContext(),
    })
  }

  return {
    handleClose,
    trackAdvocacyCopy,
    trackAdvocacyDraftPreviewToggle,
  }
}
