<template>
  <BasePromptModal :visible="visible" width-class="w-[560px]" @close="$emit('close')">
    <template #title>This space has reached the Lite limit (100 macros)</template>

    <p class="text-sm text-gray-700 mb-3">
      You've created {{ personalAuthored }} of them — thanks for building with us.
      To keep adding macros to this space, pick a path:
    </p>

    <div class="border border-blue-200 bg-blue-50 rounded p-3 mb-3">
      <div class="text-xs font-semibold text-blue-700 mb-2">★ RECOMMENDED</div>
      <div class="text-sm font-bold text-gray-900 mb-2">{{ primary.title }}</div>
      <ul class="text-xs text-gray-700 mb-3 space-y-1">
        <li v-for="f in primary.features" :key="f">✓ {{ f }}</li>
      </ul>
      <button
        data-testid="primary-cta"
        class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded text-sm cursor-pointer"
        @click="onPrimary"
      >{{ primary.ctaLabel }}</button>
    </div>

    <p class="text-xs text-gray-600 mb-2">
      {{ secondary.hint }}
      <button
        data-testid="secondary-cta"
        class="text-blue-600 hover:underline cursor-pointer"
        @click="onSecondary"
      >{{ secondary.ctaLabel }}</button>
    </p>

    <template #footer>
      <div class="flex justify-between text-xs">
        <button class="text-gray-600 hover:text-gray-800 cursor-pointer" @click="$emit('close')">Remind me later</button>
        <a href="https://zenuml.com/upgrade/" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">Why is there a limit?</a>
      </div>
    </template>
  </BasePromptModal>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import BasePromptModal from './BasePromptModal.vue'
import { trackUpgradeEvent, UpgradeEventName, Persona, ProductOption, UIComponent } from '@/utils/upgradeTracking'
import { openUrl } from '@/model/globals/forgeGlobal'

const props = defineProps<{
  visible: boolean
  personalAuthored: number
  tenantSizeEstimate: 'unknown' | 'small_likely' | 'medium_or_larger'
  upgradeUrl: string
  enterpriseBundleUrl: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const marketplaceOption = {
  product: ProductOption.MARKETPLACE,
  title: 'Marketplace — $40/yr flat (≤10 users)',
  features: [
    'Unlimited macros, all spaces, org-wide',
    'Atlassian billing',
  ],
  ctaLabel: 'Upgrade on Marketplace →',
  hint: 'Need access across all spaces?',
  secondaryLabel: 'Compare org-wide Marketplace pricing',
}

const bundleOption = {
  product: ProductOption.ENTERPRISE_BUNDLE,
  title: 'Enterprise Bundle — $299/yr for this space',
  features: [
    'Unlimited macros & users in this space',
    'No Confluence admin permission needed',
    'Activated within minutes of payment',
  ],
  ctaLabel: 'Unlock this space — $299/yr →',
  hint: 'Only need one space upgraded?',
  secondaryLabel: 'Enterprise Bundle — $299/yr for this space',
}

const primary = bundleOption

const secondary = { hint: marketplaceOption.hint, ctaLabel: marketplaceOption.secondaryLabel, product: marketplaceOption.product }

watch(() => props.visible, (v) => {
  if (v) {
    trackUpgradeEvent(UpgradeEventName.MODAL_SHOWN, {
      persona: Persona.CREATOR,
      tenant_size_estimate: props.tenantSizeEstimate,
      primary_option: primary.product,
    })
  }
}, { immediate: true })

async function onPrimary() {
  trackUpgradeEvent(UpgradeEventName.CTA_CLICKED, {
    product_option: primary.product,
    cta_position: 'primary',
    persona: Persona.CREATOR,
    ui_component: UIComponent.TOOLTIP,
  })
  await openUrl(primary.product === ProductOption.MARKETPLACE ? props.upgradeUrl : props.enterpriseBundleUrl)
  emit('close')
}

async function onSecondary() {
  trackUpgradeEvent(UpgradeEventName.CTA_CLICKED, {
    product_option: secondary.product,
    cta_position: 'secondary',
    persona: Persona.CREATOR,
    ui_component: UIComponent.TOOLTIP,
  })
  await openUrl(secondary.product === ProductOption.MARKETPLACE ? props.upgradeUrl : props.enterpriseBundleUrl)
  emit('close')
}
</script>
