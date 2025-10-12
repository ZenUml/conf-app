<template>
  <div v-show="actionRequired">
    <div class="bg-orange-50 border-t-4 border-orange-500 rounded-b text-orange-700 px-4 py-3 shadow-md" role="alert">
      <div class="flex">
        <div class="py-1">
          <svg class="fill-current h-6 w-6 text-orange-500 mr-4" viewBox="0 0 24 24" role="presentation"><path d="M13.31 5.343l7.359 13.17A1 1 0 0119.796 20H4.204a1 1 0 01-.873-1.488l7.36-13.169a1.5 1.5 0 012.618 0zM12 8.5a1.091 1.091 0 00-1.081 1.239l.513 3.766a.573.573 0 001.136 0l.513-3.766A1.091 1.091 0 0012 8.5zm0 8.63a1.125 1.125 0 100-2.25 1.125 1.125 0 000 2.25z" fill="currentColor" fill-rule="evenodd"></path></svg>
        </div>
        <div>
          <p class="font-bold">Action Required: Your space has {{macrosCreated}} macros (limit: {{MACROS_LIMIT}})</p>
          <p class="mt-1">
            To continue creating or editing diagrams, please upgrade.
            <a
              @click="trackMarketplaceClick"
              class="font-medium text-blue-600 hover:text-blue-700 underline"
              :href="upgradeUrl"
              target="_blank"
            >
              Upgrade via Marketplace (from $17/mo)
            </a>
            <span class="text-gray-600 mx-1">or</span>
            <a
              @click="trackEnterpriseBundleClick"
              class="font-medium text-blue-600 hover:text-blue-700 underline"
              :href="enterpriseBundleUrl"
              target="_blank"
            >
              Get Enterprise Bundle ($16.58/mo, includes premium tools)
            </a>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {trackEvent} from "@/utils/window";
import { useCustomerSuccessService, MACROS_LIMIT } from '@/composables/useCustomerSuccessService'

const { macrosCreated, actionRequired, upgradeUrl, enterpriseBundleUrl, initialize } = useCustomerSuccessService()

// Event tracking
const trackMarketplaceClick = () => {
  trackEvent('upgrade_marketplace', 'click', 'conversion', {
    source: 'notice_banner'
  })
}

const trackEnterpriseBundleClick = () => {
  trackEvent('upgrade_enterprise_bundle', 'click', 'conversion', {
    source: 'notice_banner'
  })
}

initialize()
</script>
