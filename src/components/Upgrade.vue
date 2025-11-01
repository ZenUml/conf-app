<template>
  <div class="relative inline-flex">
    <button
      :class="[
        'inline-flex items-center gap-1 p-1 rounded-md transition-colors duration-200 leading-[1em]',
        severityClass
      ]"
      @click="handleClick"
      @mouseenter="trackHoverEvent"
      :aria-label="ariaLabel"
    >
      <span class="text-sm font-medium text-white">
        {{ actionRequired ? 'Action Required' : 'Upgrade' }}
        <span v-if="actionRequired">({{ macrosCreated }}/{{ MACROS_LIMIT }})</span>
      </span>
    </button>
    
    <!-- Pulse indicator -->
    <span v-if="actionRequired" class="flex absolute h-3 w-3 top-0 right-0 -mt-1 -mr-1">
      <span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
            :class="severity === 'critical' ? 'bg-red-400' : 'bg-red-400'"></span>
      <span class="relative inline-flex rounded-full h-3 w-3"
            :class="severity === 'critical' ? 'bg-red-600' : 'bg-red-500'"></span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { trackUpgradeEvent, UpgradeEventName, ProductOption, UIComponent } from '@/utils/upgradeTracking'
import { useCustomerSuccessService, getUpgradeContext, MACROS_LIMIT } from '@/composables/useCustomerSuccessService'
import { computed } from 'vue'

const { macrosCreated, actionRequired, severity, upgradeUrl, initialize } = useCustomerSuccessService()

const severityClass = computed(() => {
  if (severity.value === 'critical') return 'bg-red-600 hover:bg-red-700'
  if (severity.value === 'warning') return 'bg-yellow-600 hover:bg-yellow-700'
  return 'bg-blue-500 hover:bg-blue-600'
})

const ariaLabel = computed(() => {
  if (actionRequired.value) {
    return `Action Required - ${macrosCreated.value} of ${MACROS_LIMIT} macros created`
  }
  return 'Upgrade to ZenUML Pro'
})

const handleClick = () => {
  if (actionRequired.value) {
    // Emit event to show modal (handled by parent)
    emit('showUpgradePrompt')
  } else {
    // Direct link to marketplace
    window.open(upgradeUrl.value, '_blank')
  }
  
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

const emit = defineEmits<{
  (e: 'showUpgradePrompt'): void
}>()

initialize()
</script>
