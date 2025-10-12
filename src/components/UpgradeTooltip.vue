<template>
  <div
    class="invisible group-hover:visible absolute left-0 w-[720px] z-50"
    style="top: calc(100% - 5px);"
  >
    <div class="h-3 w-full"></div>

    <div class="w-full bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden">
      <div class="flex gap-0">
        <!-- Marketplace Section (Primary - Left Column) -->
        <div class="flex-1 bg-gradient-to-br from-blue-50 to-blue-100 p-6 border-r-2 border-blue-200">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-lg">⭐</span>
            <span class="text-xs font-semibold text-blue-700 bg-blue-200 px-2 py-1 rounded-full uppercase tracking-wide">
              Recommended
            </span>
          </div>

          <h3 class="text-xl font-bold text-gray-900 mb-4">
            Upgrade via Atlassian Marketplace
          </h3>

          <div class="space-y-2 mb-5 text-sm text-gray-700">
            <div class="flex items-start gap-2">
              <svg class="w-4 h-4 text-green-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
              </svg>
              <span>Unlimited macros across all spaces</span>
            </div>
            <div class="flex items-start gap-2">
              <svg class="w-4 h-4 text-green-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
              </svg>
              <span>Works for entire organization</span>
            </div>
            <div class="flex items-start gap-2">
              <svg class="w-4 h-4 text-green-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
              </svg>
              <span>From $17/month (40 users, billed annually)</span>
            </div>
          </div>

          <a
            :href="upgradeUrl"
            target="_blank"
            rel="noopener noreferrer"
            @click="trackMarketplaceClick"
            class="block w-full bg-blue-600 hover:bg-blue-700 text-white text-center font-semibold py-3 px-4 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg"
          >
            Upgrade on Marketplace →
          </a>
        </div>

        <!-- Enterprise Bundle Section (Secondary - Right Column) -->
        <div class="flex-1 p-6 bg-gray-50">
          <div class="text-center mb-3">
            <span class="text-xs font-semibold text-gray-600 bg-gray-200 px-2 py-1 rounded-full uppercase tracking-wide">
              Alternative
            </span>
          </div>

          <h4 class="text-lg font-bold text-gray-900 mb-1 text-center">
            Enterprise Bundle
          </h4>
          <p class="text-xs text-gray-600 mb-4 text-center">
            If your company prefers to pay per space
          </p>

          <!-- Price Display - EMPHASIS ON MONTHLY -->
          <div class="bg-white border border-gray-200 rounded-lg p-3 mb-4">
            <div class="text-center">
              <div class="text-2xl font-bold text-gray-900">
                $16.58<span class="text-base text-gray-600">/mo/space</span>
              </div>
              <div class="text-xs text-gray-500 mt-1">
                $199 billed annually per space
              </div>
              <div class="mt-2 inline-block bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded-full">
                Save $379 (66% OFF)
              </div>
            </div>
          </div>

          <!-- Bundle Contents -->
          <div class="space-y-1.5 mb-4 text-xs">
            <div class="flex items-start justify-between gap-1">
              <div class="flex items-start gap-1.5">
                <svg class="w-3 h-3 text-green-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
                <span class="text-gray-700">Unlimited macros in this space</span>
              </div>
              <span class="text-xs text-gray-500 shrink-0">$200</span>
            </div>
            <div class="flex items-start justify-between gap-1">
              <div class="flex items-start gap-1.5">
                <svg class="w-3 h-3 text-green-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
                <span class="text-gray-700">ZenUML Enterprise</span>
              </div>
              <span class="text-xs text-gray-500 shrink-0">$199</span>
            </div>
            <div class="flex items-start justify-between gap-1">
              <div class="flex items-start gap-1.5">
                <svg class="w-3 h-3 text-green-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
                <span class="text-gray-700">Diagramly Plus</span>
              </div>
              <span class="text-xs text-gray-500 shrink-0">$179</span>
            </div>
          </div>

          <a
            :href="enterpriseBundleUrl"
            target="_blank"
            rel="noopener noreferrer"
            @click="trackEnterpriseBundleClick"
            class="block w-full bg-white hover:bg-gray-50 text-gray-900 text-center font-semibold py-2.5 px-4 rounded-lg transition-colors duration-200 border-2 border-gray-300 hover:border-gray-400 text-sm"
          >
            Get Enterprise Bundle →
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { trackEvent } from '@/utils/window'

defineProps<{
  macrosCreated: number
  macrosLimit: number
  upgradeUrl: string
  enterpriseBundleUrl: string
}>()

const emit = defineEmits<{
  (e: 'click'): void
}>()

const trackMarketplaceClick = () => {
  trackEvent('upgrade_marketplace', 'click', 'conversion', {
    source: 'tooltip',
    position: 'primary'
  })
  emit('click')
}

const trackEnterpriseBundleClick = () => {
  trackEvent('upgrade_enterprise_bundle', 'click', 'conversion', {
    source: 'tooltip',
    position: 'secondary'
  })
  emit('click')
}
</script>
