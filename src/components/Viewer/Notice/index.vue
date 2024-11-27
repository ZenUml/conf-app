<template>
  <div v-show="actionRequired">
    <div class="bg-orange-50 border-t-4 border-orange-500 rounded-b text-orange-700 px-4 py-3 shadow-md" role="alert">
      <div class="flex">
        <p>Please ask your space admin to upgrade your plan.
          <a @click="trackClickEvent" class="font-medium text-blue-600 dark:text-blue-500 hover:underline" :href="upgradeUrl" target="_blank">[Learn more about plan limits]</a>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {trackEvent} from "@/utils/window";
import { useCustomerSuccessService } from '@/composables/useCustomerSuccessService'

const {actionRequired, initialize } = useCustomerSuccessService()

// Event tracking
const trackClickEvent = () => {
  trackEvent('upgrade', 'click', 'conversion')
}

initialize()
</script>
