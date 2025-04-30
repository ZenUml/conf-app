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
import {trackEvent} from "@/utils/window";
import { useCustomerSuccessService, MACROS_LIMIT } from '@/composables/useCustomerSuccessService'
import { computed } from 'vue'
// @ts-ignore
import UpgradeTooltip from './UpgradeTooltip.vue'

const { macrosCreated, actionRequired, upgradeUrl, initialize } = useCustomerSuccessService()

const ariaLabel = computed(() => {
  if (actionRequired) {
    return `Action Required - ${macrosCreated} of ${MACROS_LIMIT} macros created`
  }
  return 'Upgrade to ZenUML Pro'
})

const trackClickEvent = () => {
  trackEvent('upgrade', 'click', 'conversion')
}

const trackHoverEvent = () => {
  trackEvent('upgrade', 'hover', 'conversion')
}

initialize()
</script>
