<template>
  <div class="relative inline-flex">
    <a
      :class="[
        'inline-flex items-center gap-1 p-1 rounded-md transition-colors duration-200 leading-[1em]',
        shouldShowTooltip ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-blue-500 hover:bg-blue-600'
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
          Upgrade
          <span v-if="shouldShowTooltip">
            (<span>{{ macrosCreated }}</span><span>/</span><span>{{ macrosLimit }}</span>)
          </span>
        </span>

        <UpgradeTooltip
          v-if="shouldShowTooltip"
          :macros-created="macrosCreated"
          :macros-limit="macrosLimit"
          :upgrade-url="upgradeUrl"
          @click="trackClickEvent"
        />
      </div>
    </a>
    <span v-if="shouldShowTooltip" class="flex absolute h-3 w-3 top-0 right-0 -mt-1 -mr-1">
      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
      <span class="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { trackEvent } from "@/utils/window"
import macroMetrics from "@/services/MacroMetrics"
import getFeatureFlagsForCurrentDomain from "@/apis/featureFlags"
// @ts-ignore
import UpgradeTooltip from './UpgradeTooltip.vue'

// Constants
const upgradeUrl = 'https://zenuml.com/upgrade/'
const macrosLimit = 100
const WARNING_THRESHOLD = 85

// State
const macrosCreated = ref<number>(0)
const customerSuccessServiceEnabled = ref<boolean>(false)

// Computed
const shouldShowTooltip = computed(() => {
  const showTooltip = macrosCreated.value >= WARNING_THRESHOLD && customerSuccessServiceEnabled.value
  console.debug('shouldShowTooltip', showTooltip)
  return showTooltip
})

const ariaLabel = computed(() => 'Upgrade account - Macro limit exceeded')

// Feature flag handling
const handleCustomerSuccessService = async (metrics: any) => {
  const customerSuccessService = await getFeatureFlagsForCurrentDomain(['CUSTOMER_SUCCESS_SERVICE'])
  // @ts-ignore
  if (!customerSuccessService.CUSTOMER_SUCCESS_SERVICE) {
    trackEvent('', 'hold', 'conversion')
    return false
  }

  trackEvent('', 'enhance-upgrade-button', 'conversion', { metrics })
  return true
}

// Metrics loading
const loadMacroMetrics = async () => {
  const metrics = await macroMetrics.getMacroMetrics()
  if (metrics?.total) {
    macrosCreated.value = metrics.total
  }

  customerSuccessServiceEnabled.value = await handleCustomerSuccessService(metrics)
}

// Event tracking
const trackClickEvent = () => {
  trackEvent('upgrade', 'click', 'conversion')
}

const trackHoverEvent = () => {
  trackEvent('upgrade', 'hover', 'conversion')
}

// Initialize
loadMacroMetrics()
</script>
