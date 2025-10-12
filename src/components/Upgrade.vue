<template>
  <div class="relative inline-flex">
    <a
      :class="[
        'inline-flex items-center gap-1 p-1 rounded-md transition-colors duration-200 leading-[1em]',
        actionRequired ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-blue-500 hover:bg-blue-600'
      ]"
      :href="upgradeUrl"
      target="_blank"
      rel="noopener noreferrer"
      @click="trackClickEvent"
      @mouseenter="trackHoverEvent"
      :aria-label="ariaLabel"
    >
      <div class="relative group inline-flex">
        <span class="text-sm font-medium text-white">
          {{ actionRequired ? 'Action Required' : 'Upgrade' }}
          <span v-if="actionRequired">
            ({{ macrosCreated }}/{{ MACROS_LIMIT }})
          </span>
        </span>

        <UpgradeTooltip
          v-if="actionRequired"
          :macros-created="macrosCreated"
          :macros-limit="MACROS_LIMIT"
          :upgrade-url="upgradeUrl"
          :enterprise-bundle-url="enterpriseBundleUrl"
          @click="trackClickEvent"
        />
      </div>
    </a>
    <span v-if="actionRequired" class="flex absolute h-3 w-3 top-0 right-0 -mt-1 -mr-1">
      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
      <span class="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { trackUpgradeEvent, UpgradeEventName, ProductOption, UIComponent } from '@/utils/upgradeTracking'
import { useCustomerSuccessService, getUpgradeContext, MACROS_LIMIT } from '@/composables/useCustomerSuccessService'
import { computed } from 'vue'
// @ts-ignore
import UpgradeTooltip from './UpgradeTooltip.vue'

const { macrosCreated, actionRequired, upgradeUrl, enterpriseBundleUrl, initialize } = useCustomerSuccessService()

const ariaLabel = computed(() => {
  if (actionRequired) {
    return `Action Required - ${macrosCreated} of ${MACROS_LIMIT} macros created`
  }
  return 'Upgrade to ZenUML Pro'
})

const trackClickEvent = () => {
  // Header badge links directly to Marketplace
  trackUpgradeEvent(UpgradeEventName.CTA_CLICKED, {
    product_option: ProductOption.MARKETPLACE,
    ui_component: UIComponent.HEADER_BADGE,
    ...getUpgradeContext(),
  })
}

const trackHoverEvent = () => {
  trackUpgradeEvent(UpgradeEventName.PROMPT_HOVERED, {
    ui_component: UIComponent.HEADER_BADGE,
    ...getUpgradeContext(),
  })
}

initialize()
</script>
