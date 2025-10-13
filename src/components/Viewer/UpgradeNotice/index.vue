<template>
  <div v-show="actionRequired">
    <div class="bg-orange-50 border-t-4 border-orange-500 rounded-b text-orange-700 px-4 py-3 shadow-md" role="alert">
      <div class="flex">
        <p>Please ask your space admin to upgrade your plan.
          <a @click="trackClickEvent" class="font-medium text-blue-600 dark:text-blue-500 hover:underline" :href="learnMoreUrl" target="_blank">[Learn more about plan limits]</a>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { trackUpgradeEvent, UpgradeEventName, ProductOption, UIComponent } from '@/utils/upgradeTracking'
import { useCustomerSuccessService, getUpgradeContext } from '@/composables/useCustomerSuccessService'

const {actionRequired, learnMoreUrl, initialize } = useCustomerSuccessService()

// Event tracking
const trackClickEvent = () => {
  trackUpgradeEvent(UpgradeEventName.CTA_CLICKED, {
    product_option: ProductOption.UNKNOWN,
    ui_component: UIComponent.VIEWER_NOTICE,
    ...getUpgradeContext(),
  })
}

initialize()
</script>
