<template>
  <div v-show="actionRequired">
    <div class="bg-orange-50 border-t-4 border-orange-500 rounded-b text-orange-700 px-4 py-3 shadow-md" role="alert">
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0 mt-0.5">
          <svg class="w-5 h-5 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
        </div>
        <div class="flex-1">
          <p class="font-bold text-orange-800 mb-1">Action Required: Your space has {{macrosCreated}} macros (limit: {{MACROS_LIMIT}})</p>
          <p class="text-sm text-orange-700 mb-3">To continue creating or editing diagrams, please upgrade.</p>
          <div class="flex flex-wrap gap-3 items-center">
            <a
              @click="trackMarketplaceClick"
              class="inline-flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-sm hover:shadow-md"
              :href="upgradeUrl"
              target="_blank"
            >
              <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
              </svg>
              Marketplace
              <span class="ml-1 text-xs opacity-90">(e.g., $17/mo for 40 users)</span>
            </a>
            <span class="text-gray-600 text-sm">or</span>
            <div class="relative group">
              <a
                @click="trackEnterpriseBundleClick"
                class="inline-flex items-center px-3 py-1.5 bg-gray-700 hover:bg-gray-800 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-sm hover:shadow-md"
                :href="enterpriseBundleUrl"
                target="_blank"
              >
                <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                </svg>
                Enterprise Bundle
                <span class="ml-1 text-xs opacity-90">($16.58/mo/space)</span>
              </a>
              <div class="invisible group-hover:visible absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg whitespace-nowrap z-10">
                Includes ZenUML Enterprise + Diagramly Plus + unlimited macros
                <div class="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { trackUpgradeEvent, UpgradeEventName, ProductOption, UIComponent } from '@/utils/upgradeTracking'
import { useCustomerSuccessService, getUpgradeContext, MACROS_LIMIT } from '@/composables/useCustomerSuccessService'

const { macrosCreated, actionRequired, upgradeUrl, enterpriseBundleUrl, initialize } = useCustomerSuccessService()

// Event tracking
const trackMarketplaceClick = () => {
  trackUpgradeEvent(UpgradeEventName.CTA_CLICKED, {
    product_option: ProductOption.MARKETPLACE,
    ui_component: UIComponent.BANNER,
    ...getUpgradeContext(),
  })
}

const trackEnterpriseBundleClick = () => {
  trackUpgradeEvent(UpgradeEventName.CTA_CLICKED, {
    product_option: ProductOption.ENTERPRISE_BUNDLE,
    ui_component: UIComponent.BANNER,
    ...getUpgradeContext(),
  })
}

initialize()
</script>
