import { ref, watch } from 'vue'
import { trackUpgradeEvent, UpgradeEventName, UIComponent } from '@/utils/upgradeTracking'
import { getUpgradeContext } from '@/composables/useCustomerSuccessService'
import type { PaywallActionType } from '@/utils/paywall/mountPaywallGate'

export function useUpgradeTracking(
  visible: () => boolean,
  onClose: () => void,
  actionType: () => PaywallActionType | undefined = () => undefined,
) {
  const modalShownTime = ref<number>(0)

  watch(visible, (newVisible: boolean) => {
    if (newVisible) {
      modalShownTime.value = Date.now()
      trackUpgradeEvent(UpgradeEventName.MODAL_SHOWN, {
        action_type: actionType(),
        ...getUpgradeContext(),
      })
    }
  }, { immediate: true })

  const handleClose = () => {
    const timeSpent = Date.now() - modalShownTime.value
    trackUpgradeEvent(UpgradeEventName.MODAL_DISMISSED, {
      action_type: actionType(),
      time_spent: Math.round(timeSpent / 1000),
      ...getUpgradeContext(),
    })
    onClose()
  }

  const trackAdvocacyCopy = () => {
    const timeToDecision = Date.now() - modalShownTime.value
    trackUpgradeEvent(UpgradeEventName.ADVOCACY_MESSAGE_COPIED, {
      action_type: actionType(),
      ui_component: UIComponent.MODAL,
      time_to_decision: Math.round(timeToDecision / 1000),
      ...getUpgradeContext(),
    })
  }

  /** User toggled the collapsible advocacy draft preview in the paywall modal. */
  const trackAdvocacyDraftPreviewToggle = (expanded: boolean) => {
    const timeToDecision = Date.now() - modalShownTime.value
    trackUpgradeEvent(UpgradeEventName.ADVOCACY_DRAFT_PREVIEW_CLICKED, {
      action_type: actionType(),
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
