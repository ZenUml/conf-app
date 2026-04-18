<template>
  <div class="p-4 border-r border-gray-200">
    <h3 class="text-base font-bold text-gray-900 mb-3">Marketplace</h3>
    <!-- Best For -->
    <div class="bg-blue-50 rounded p-2 mb-3 border border-blue-200">
      <div class="flex items-start gap-1.5 text-xs text-gray-700">
        <span class="text-blue-500">💡</span>
        <div>
          <span class="font-semibold">Best for:</span> Multiple spaces heavily use this app
        </div>
      </div>
    </div>

    <!-- Features -->
    <div class="space-y-1.5 mb-3 text-xs text-gray-700">
      <div class="flex gap-1.5">
        <span class="text-green-600">✓</span>
        <span>Unlimited macros (all spaces)</span>
      </div>
      <div class="flex gap-1.5">
        <span class="text-green-600">✓</span>
        <span>Org-wide license</span>
      </div>
      <div class="flex gap-1.5">
        <span class="text-green-600">✓</span>
        <span>Payment processed with Confluence billing</span>
      </div>
    </div>

    <!-- Slider Section -->
    <PricingSlider :model-value="pricing.sliderValue.value" @update:model-value="handleSliderChange" />

    <!-- Calculated Price -->
    <div class="bg-blue-50 rounded p-2 mb-3 border border-blue-200">
      <div class="text-xs text-gray-500 mt-1">
        {{ pricing.currentTierName.value }}: ${{ pricing.currentRate.value }}/user/mo
      </div>
      <div class="flex items-baseline justify-between">
        <div class="text-2xl font-bold text-blue-600 tabular-nums">
          {{ pricing.confluenceUsers.value.toLocaleString() }} <span class="text-sm font-normal text-gray-600">users</span>
        </div>
        <div class="text-2xl font-bold text-blue-600 tabular-nums">
          ${{ pricing.marketplaceAnnualCost.value.toLocaleString() }}<span class="text-sm font-normal text-gray-600">/yr</span>
        </div>
      </div>
      <div class="text-xs text-gray-500 mt-2">
        The price is estimated. Go to <a href="https://marketplace.atlassian.com/apps/1218380/zenuml-diagrams-for-confluence?tab=pricing" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">Atlassian's pricing page</a> to get their estimation. Discount may apply.
      </div>
    </div>

    <!-- CTA Button -->
    <button
      @click="openUpgradeUrl"
      class="block w-full bg-blue-600 hover:bg-blue-700 text-white text-center font-semibold py-2 px-3 rounded text-sm transition-colors duration-200 cursor-pointer"
    >
      Upgrade →
    </button>
  </div>
</template>

<script setup lang="ts">
import PricingSlider from './PricingSlider.vue'
import { usePricingCalculator } from './usePricingCalculator'
import { openUrl } from '@/model/globals/forgeGlobal'

const props = defineProps<{
  upgradeUrl: string
}>()

const emit = defineEmits<{
  (e: 'slider-change', userCount: number, annualCost: number): void
  (e: 'cta-click'): void
}>()

const pricing = usePricingCalculator(50)

const handleSliderChange = (newValue: number) => {
  pricing.sliderValue.value = newValue
  pricing.handleSliderChange()
  emit('slider-change', pricing.confluenceUsers.value, pricing.marketplaceAnnualCost.value)
}

const openUpgradeUrl = async () => {
  emit('cta-click')
  await openUrl(props.upgradeUrl)
}
</script>
