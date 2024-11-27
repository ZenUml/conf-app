<template>
  <div v-show="actionRequired">
    <div class="bg-orange-50 border-t-4 border-orange-500 rounded-b text-orange-700 px-4 py-3 shadow-md" role="alert">
      <div class="flex">
        <div class="py-1">
          <svg class="fill-current h-6 w-6 text-orange-500 mr-4" viewBox="0 0 24 24" role="presentation"><path d="M13.31 5.343l7.359 13.17A1 1 0 0119.796 20H4.204a1 1 0 01-.873-1.488l7.36-13.169a1.5 1.5 0 012.618 0zM12 8.5a1.091 1.091 0 00-1.081 1.239l.513 3.766a.573.573 0 001.136 0l.513-3.766A1.091 1.091 0 0012 8.5zm0 8.63a1.125 1.125 0 100-2.25 1.125 1.125 0 000 2.25z" fill="currentColor" fill-rule="evenodd"></path></svg>
        </div>
        <div>
          <p class="font-bold">Warning: Your space contains {{macrosCreated}} macros, but will be limited to {{MACROS_LIMIT}} macros on March 1, 2025 under the free plan.</p>
          <p>To continue creating new macros or modifying existing ones, please ask your space admin to upgrade your plan.
            <a @click="trackClickEvent" class="font-medium text-blue-600 dark:text-blue-500 hover:underline" :href="upgradeUrl" target="_blank">[Learn more about plan limits]</a>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {trackEvent} from "@/utils/window";
import { useCustomerSuccessService, MACROS_LIMIT } from '@/composables/useCustomerSuccessService'

const { macrosCreated, actionRequired, initialize } = useCustomerSuccessService()
const upgradeUrl = 'https://zenuml.com/upgrade/'

// Event tracking
const trackClickEvent = () => {
  trackEvent('upgrade', 'click', 'conversion')
}

initialize()
</script>
