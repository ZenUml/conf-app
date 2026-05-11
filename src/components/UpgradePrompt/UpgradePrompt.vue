<template>
  <Teleport to="body">
    <div ref="modalContainer" v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center p-4" tabindex="-1" @keydown.esc="tracking.handleClose">
      <!-- Backdrop. 75% opacity (was 50%) so the editor underneath is dimmed
           enough to recede as context, not distract from the modal. -->
      <div class="fixed inset-0 bg-black bg-opacity-75" @click="tracking.handleClose"></div>

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

        <!-- Hero: illustration + title + body -->
        <PaywallHero />

        <!-- Collapsible draft preview -->
        <div class="px-4 pb-1">
          <button
            class="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 cursor-pointer select-none w-full"
            @click="onDraftPreviewToggle"
            :aria-expanded="draftExpanded ? 'true' : 'false'"
            data-testid="draft-toggle-btn"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              :class="draftExpanded ? 'rotate-90' : ''"
              class="transition-transform duration-150 shrink-0"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Preview the draft before you copy
          </button>
        </div>
        <DraftCard v-if="draftExpanded" :ctx="messageContext" />

        <!-- Primary advocacy CTA -->
        <AdvocacyButton
          :message="message"
          @copied="tracking.trackAdvocacyCopy"
        />

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
import { ref, computed, watch, nextTick } from 'vue'
import PaywallHero from './PaywallHero.vue'
import DraftCard from './DraftCard.vue'
import AdvocacyButton from './AdvocacyButton.vue'
import { useUpgradeTracking } from './useUpgradeTracking'
import { trackUpgradeEvent, UpgradeEventName } from '@/utils/upgradeTracking'
import { useCustomerSuccessService } from '@/composables/useCustomerSuccessService'
import {
  buildAdvocacyMessage,
  type AdvocacyMessageContext,
  type MacroKind,
} from './buildAdvocacyMessage'
import { ENTERPRISE_BUNDLE_ANNUAL_COST } from './upgradePrompt'

const ENTERPRISE_BUNDLE_PRICE = `$${ENTERPRISE_BUNDLE_ANNUAL_COST}/yr/space`

const props = withDefaults(
  defineProps<{
    visible: boolean
    macrosCreated: number
    macrosLimit: number
    upgradeUrl: string
    enterpriseBundleUrl: string
    macroKind?: MacroKind
  }>(),
  { macroKind: 'unknown' }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'continueEditing'): void
}>()

function onContinueEditing() {
  trackUpgradeEvent(UpgradeEventName.PAYWALL_CONTINUED_EDITING)
  emit('continueEditing')
}

const customerSuccess = useCustomerSuccessService() as ReturnType<typeof useCustomerSuccessService> | undefined

const messageContext = computed<AdvocacyMessageContext>(() => ({
  spaceKey: customerSuccess?.spaceKey?.value ?? '',
  macroCount: props.macrosCreated,
  macrosLimit: props.macrosLimit,
  upgradeUrl: props.upgradeUrl,
  enterpriseBundleUrl: props.enterpriseBundleUrl,
  enterpriseBundlePrice: ENTERPRISE_BUNDLE_PRICE,
  macroKind: props.macroKind,
}))

const message = computed(() => buildAdvocacyMessage(messageContext.value))

const tracking = useUpgradeTracking(() => props.visible, () => emit('close'))

const draftExpanded = ref(false)

function onDraftPreviewToggle() {
  const willExpand = !draftExpanded.value
  draftExpanded.value = willExpand
  tracking.trackAdvocacyDraftPreviewToggle(willExpand)
}

const modalContainer = ref<HTMLElement | null>(null)
watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    modalContainer.value?.focus()
  }
})
</script>
