<template>
  <Teleport to="body">
    <div ref="modalContainer" v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center p-4" tabindex="-1" @keydown.esc="tracking.handleClose">
      <!-- Backdrop -->
      <div class="fixed inset-0 bg-black bg-opacity-50" @click="tracking.handleClose"></div>

      <!-- Modal content - Optimized for 700×600px iframe -->
      <div class="relative bg-white rounded-lg shadow-xl w-[680px] max-h-[660px] overflow-y-auto">
        <!-- Header - Factual -->
        <div class="px-4 py-2 border-b border-gray-200">
          <h2 class="text-sm font-semibold text-gray-900">
            This space has reached the ZenUML Lite limit ({{ macrosLimit }} macros).
          </h2>
          <p class="text-xs text-gray-600 mt-0.5">
            Existing diagrams still render. To create or edit, upgrade the space.
          </p>
        </div>

        <!-- Calculator Heading - Slim -->
        <div class="px-4 py-2 bg-gray-50 border-b border-gray-200">
          <h3 class="text-base font-bold text-gray-900">Pick the upgrade that fits your team</h3>
        </div>

        <!-- Two-column pricing comparison - Compact -->
        <div class="grid grid-cols-2 gap-0 border-b border-gray-200">
          <!-- Marketplace Section -->
          <MarketplacePricingCard
            :upgrade-url="upgradeUrl"
            @slider-change="handleSliderChange"
            @cta-click="tracking.trackMarketplaceClick"
          />

          <!-- Enterprise Bundle Section -->
          <EnterpriseBundleCard
            :bundle-url="enterpriseBundleUrl"
            @cta-click="tracking.trackEnterpriseBundleClick"
          />
        </div>

        <!-- Footer - Continue editing + Learn more -->
        <div class="px-4 py-2 bg-gray-50 flex justify-between items-center">
          <button
            data-testid="continue-editing-btn"
            class="text-xs text-gray-600 hover:text-gray-800 hover:underline cursor-pointer"
            @click="onContinueEditing"
          >Continue editing without upgrading</button>
          <a
            href="https://zenuml.com/upgrade/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-blue-600 hover:text-blue-800 hover:underline"
          >
            Why do I need to upgrade? →
          </a>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import MarketplacePricingCard from './MarketplacePricingCard.vue'
import EnterpriseBundleCard from './EnterpriseBundleCard.vue'
import { useUpgradeTracking } from './useUpgradeTracking'
import { trackUpgradeEvent, UpgradeEventName } from '@/utils/upgradeTracking'

const props = defineProps<{
  visible: boolean
  macrosCreated: number
  macrosLimit: number
  upgradeUrl: string
  enterpriseBundleUrl: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'continueEditing'): void
}>()

function onContinueEditing() {
  trackUpgradeEvent(UpgradeEventName.PAYWALL_CONTINUED_EDITING, {
    prompt_variant: 'legacy',
  })
  emit('continueEditing')
}

// Track current pricing values from MarketplacePricingCard
const currentUserCount = ref(50)
const currentAnnualCost = ref(0)

// Initialize tracking
const tracking = useUpgradeTracking(
  () => props.visible,
  () => currentUserCount.value,
  () => currentAnnualCost.value,
  () => emit('close')
)

// Handle slider changes with tracking
const handleSliderChange = (userCount: number, annualCost: number) => {
  currentUserCount.value = userCount
  currentAnnualCost.value = annualCost
  tracking.trackSliderChange()
}

const modalContainer = ref<HTMLElement | null>(null)
watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    modalContainer.value?.focus()
  }
})
</script>
