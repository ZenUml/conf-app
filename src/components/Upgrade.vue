<template>
  <a
    :class="[
      'inline-flex items-center gap-1 p-1 rounded-md transition-colors duration-200 leading-[1em]',
      shouldShowTooltip ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-blue-500 hover:bg-blue-600'
    ]"
    :href="upgradeUrl"
    target="_blank"
    rel="noopener noreferrer"
    @click="trackClickEvent"
    :aria-label="ariaLabel"
  >
    <div class="relative group">
      <span class="text-sm font-medium text-white">
        Upgrade
      </span>

      <div
        v-if="shouldShowTooltip"
        class="invisible group-hover:visible absolute left-0 w-96 z-50"
        style="top: calc(100% - 5px);"
      >
        <div class="h-3 w-full"></div>

        <div class="w-full">
          <a
            class="block p-4 rounded-lg bg-gray-900 text-white shadow-lg hover:shadow-xl transition-shadow duration-200"
            :href="upgradeUrl"
            target="_blank"
            rel="noopener noreferrer"
            @click="trackClickEvent"
          >
            <!-- Usage Status - Redesigned -->
            <div class="font-medium text-blue-400">
              Space macro usage:
              <span class="text-white">{{ macrosCreated }}</span>
              <span class="text-gray-400">/</span>
              <span class="text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
                {{ macrosLimit }}
              </span>
            </div>

            <!-- Main Message -->
            <div class="mt-2 text-sm text-gray-300">
              Starting March 1, 2025, free tier spaces will be limited to <span class="font-medium text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
                {{ macrosLimit }}
              </span> macros.
            </div>

            <!-- Action Message -->
            <div class="mt-2 text-sm">
              <span class="text-green-400">Viewing remains unlimited.</span>
              <span class="text-gray-300"> Upgrade needed for creating new or editing existing macros.</span>
            </div>

            <!-- Upgrade Button -->
            <div class="mt-3">
              <span class="inline-flex items-center gap-1 text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors duration-200">
                Upgrade now
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="w-4 h-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                    clip-rule="evenodd"
                  />
                </svg>
              </span>
            </div>
          </a>
        </div>
      </div>
    </div>
  </a>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { trackEvent } from "@/utils/window"
import macroMetrics from "@/services/MacroMetrics"
import getFeatureFlagsForCurrentDomain from "@/apis/featureFlags";
import globals from "@/model/globals";

// Constants
const upgradeUrl = 'https://zenuml.com/upgrade/'
const macrosLimit = 100
const WARNING_THRESHOLD = 85

// State
const macrosCreated = ref<number>(0);
const customerSuccessServiceEnabled = ref<boolean>(false);
// Computed
const shouldShowTooltip = computed(() => {
  let showTooltip = macrosCreated.value >= WARNING_THRESHOLD && customerSuccessServiceEnabled.value;
  console.debug('shouldShowTooltip', showTooltip);
  return showTooltip;
})
const ariaLabel = computed(() => 'Upgrade account - Macro limit exceeded')

// Load initial data
const loadMacroMetrics = async () => {
  const metrics = await macroMetrics.getMacroMetrics()
  if (metrics?.total) {
    macrosCreated.value = metrics.total
  }

  const macroData = await globals.apWrapper.getMacroData();
  const customerSuccessService = await getFeatureFlagsForCurrentDomain(['CUSTOMER_SUCCESS_SERVICE']);
  // @ts-ignore
  if (!customerSuccessService.CUSTOMER_SUCCESS_SERVICE) {
    trackEvent(macroData?.uuid, 'hold', 'conversion')
  } else {
    customerSuccessServiceEnabled.value = true;
    trackEvent(macroData?.uuid, 'enhance-upgrade-button', 'conversion', { metrics });
  }
}
loadMacroMetrics()

// Methods
const trackClickEvent = () => {
  trackEvent('upgrade', 'click', 'conversion')
}
</script>