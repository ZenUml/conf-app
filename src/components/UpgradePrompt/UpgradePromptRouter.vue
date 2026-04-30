<template>
  <component
    :is="activeComponent"
    v-bind="activeProps"
    :visible="visible"
    @close="$emit('close')"
    @show-heavy-creator="ownerSelfIdentified = true"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import LegacyPrompt from './UpgradePrompt.vue'
import HeavyCreatorPrompt from './HeavyCreatorPrompt.vue'
import BystanderNotice from './BystanderNotice.vue'
import ComparisonView from './ComparisonView.vue'
import { useCustomerSuccessService } from '@/composables/useCustomerSuccessService'
import { trackUpgradeEvent, UpgradeEventName } from '@/utils/upgradeTracking'

const props = defineProps<{
  visible: boolean
  macrosCreated: number
  macrosLimit: number
  upgradeUrl: string
  enterpriseBundleUrl: string
  spaceKey?: string
  requesterDisplayName?: string
}>()

defineEmits<{ (e: 'close'): void }>()

const svc = useCustomerSuccessService()
const ownerSelfIdentified = ref(false)

const activeComponent = computed(() => {
  if (!svc.personaAwarePaywallEnabled.value) return LegacyPrompt
  const p = svc.persona.value
  if (p === 'bystander' && !ownerSelfIdentified.value) return BystanderNotice
  if (svc.tenantSizeEstimate.value === 'unknown') return ComparisonView
  return HeavyCreatorPrompt
})

const activeProps = computed(() => {
  const c = activeComponent.value
  if (c === LegacyPrompt) {
    return {
      macrosCreated: props.macrosCreated,
      macrosLimit: props.macrosLimit,
      upgradeUrl: props.upgradeUrl,
      enterpriseBundleUrl: props.enterpriseBundleUrl,
    }
  }
  if (c === BystanderNotice) {
    return {
      spaceKey: props.spaceKey ?? '',
      requesterDisplayName: props.requesterDisplayName,
    }
  }
  if (c === ComparisonView) {
    return {
      upgradeUrl: props.upgradeUrl,
      enterpriseBundleUrl: props.enterpriseBundleUrl,
    }
  }
  return {
    personalAuthored: svc.personalAuthored.value,
    tenantSizeEstimate: svc.tenantSizeEstimate.value,
    upgradeUrl: props.upgradeUrl,
    enterpriseBundleUrl: props.enterpriseBundleUrl,
  }
})

watch(
  () => props.visible,
  (isVisible) => {
    if (!isVisible) return

    // LegacyPrompt and HeavyCreatorPrompt already emit this event.
    if (activeComponent.value === BystanderNotice || activeComponent.value === ComparisonView) {
      trackUpgradeEvent(UpgradeEventName.MODAL_SHOWN, {
        prompt_variant: activeComponent.value === BystanderNotice ? 'bystander_notice' : 'comparison_view',
      })
    }
  },
  { immediate: true }
)
</script>
