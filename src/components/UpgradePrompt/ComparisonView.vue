<template>
  <BasePromptModal :visible="visible" width-class="w-[680px]" @close="$emit('close')">
    <template #title>This space has reached the Lite limit (100 macros)</template>

    <p class="text-sm text-gray-700 mb-3">
      Pick the path that fits — both options unlock unlimited macros in different ways:
    </p>

    <div class="grid grid-cols-2 gap-0 border border-gray-200 rounded">
      <MarketplacePricingCard
        :upgrade-url="upgradeUrl"
        @cta-click="onMarketplace"
      />
      <EnterpriseBundleCard
        :bundle-url="enterpriseBundleUrl"
        @cta-click="onBundle"
      />
    </div>

    <template #footer>
      <div class="flex justify-end text-xs">
        <a href="https://zenuml.com/upgrade/" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">Why is there a limit?</a>
      </div>
    </template>
  </BasePromptModal>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import BasePromptModal from './BasePromptModal.vue'
import MarketplacePricingCard from './MarketplacePricingCard.vue'
import EnterpriseBundleCard from './EnterpriseBundleCard.vue'
import { trackUpgradeEvent, UpgradeEventName, Persona, ProductOption, UIComponent } from '@/utils/upgradeTracking'

const props = defineProps<{
  visible: boolean
  upgradeUrl: string
  enterpriseBundleUrl: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

watch(() => props.visible, (v) => {
  if (v) {
    trackUpgradeEvent(UpgradeEventName.COMPARISON_VIEW_SHOWN, { tenant_size_estimate: 'unknown' })
  }
}, { immediate: true })

function onMarketplace() {
  trackUpgradeEvent(UpgradeEventName.CTA_CLICKED, { product_option: ProductOption.MARKETPLACE, cta_position: 'primary', ui_component: UIComponent.TOOLTIP })
  emit('close')
}
function onBundle() {
  trackUpgradeEvent(UpgradeEventName.CTA_CLICKED, { product_option: ProductOption.ENTERPRISE_BUNDLE, cta_position: 'primary', ui_component: UIComponent.TOOLTIP })
  emit('close')
}
</script>
