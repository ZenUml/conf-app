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

        <!-- Support-assisted extension CTA -->
        <div class="px-4 pb-3">
          <div class="rounded-md border border-blue-100 bg-blue-50 px-3 py-2">
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs text-blue-950 leading-5">
                Need time to review upgrade options? Request a temporary extension from support.
              </p>
              <button
                data-testid="request-extension-btn"
                class="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                @click="onRequestExtension"
              >Request extension</button>
            </div>
            <p
              v-if="extensionRequestStatus"
              class="mt-1 text-[11px] text-blue-800"
              data-testid="request-extension-status"
            >{{ extensionRequestStatus }}</p>
          </div>
        </div>

        <!-- Footer - Continue editing + Learn more -->
        <div class="px-4 py-2 bg-gray-50 flex justify-between items-center gap-3">
          <div class="min-w-0">
            <button
              v-if="canContinueEditing"
              data-testid="continue-editing-btn"
              class="text-xs text-gray-600 hover:text-gray-800 hover:underline cursor-pointer"
              :title="continueAttemptsTooltip"
              :aria-label="continueButtonAriaLabel"
              @click="onContinueEditing"
            >{{ continueButtonCopy }}</button>
            <span
              v-else
              data-testid="continue-attempts-exhausted"
              class="text-xs text-gray-500"
              :title="continueAttemptsTooltip"
              :aria-label="continueButtonAriaLabel"
            >Request extension to continue editing</span>
          </div>
          <a
            href="https://zenuml.com/upgrade/"
            target="_blank"
            rel="noopener noreferrer"
            class="shrink-0 text-xs text-blue-600 hover:text-blue-800 hover:underline"
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
import type { PaywallActionType } from '@/utils/paywall/mountPaywallGate'
import { CONTINUE_ATTEMPTS_STORAGE_SOURCE } from '@/utils/paywall/continueAttempts'
import { getUpgradeContext, useCustomerSuccessService } from '@/composables/useCustomerSuccessService'
import {
  buildAdvocacyMessage,
  type AdvocacyMessageContext,
  type MacroKind,
} from './buildAdvocacyMessage'
import {
  buildExtensionRequestContext,
  buildExtensionRequestMessage,
  extensionRequestUrl,
} from './buildExtensionRequest'
import { ENTERPRISE_BUNDLE_ANNUAL_COST } from './upgradePrompt'
import { openUrl } from '@/model/globals/forgeGlobal'

const ENTERPRISE_BUNDLE_PRICE = `$${ENTERPRISE_BUNDLE_ANNUAL_COST}/yr/space`

const props = withDefaults(
  defineProps<{
    visible: boolean
    macrosCreated: number
    macrosLimit: number
    upgradeUrl: string
    enterpriseBundleUrl: string
    macroKind?: MacroKind
    actionType?: PaywallActionType
    remainingContinueAttempts?: number
  }>(),
  { macroKind: 'unknown' }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'continueEditing'): void
}>()

function onContinueEditing() {
  const attemptsBefore = props.remainingContinueAttempts
  const attemptsAfter = attemptsBefore === undefined
    ? undefined
    : Math.max(0, attemptsBefore - 1)
  const attemptTrackingPayload = attemptsBefore === undefined
    ? {}
    : {
        remaining_attempts_before: attemptsBefore,
        remaining_attempts_after: attemptsAfter,
        storage_source: CONTINUE_ATTEMPTS_STORAGE_SOURCE,
      }

  // Pass action_type only when set so unit tests (which mount without it)
  // keep the existing single-arg call shape. Production always sets actionType
  // via PaywallGate, so the per-surface continued_rate breakdown still works.
  if (props.actionType !== undefined) {
    trackUpgradeEvent(UpgradeEventName.PAYWALL_CONTINUED_EDITING, {
      action_type: props.actionType,
      ...attemptTrackingPayload,
    })
  } else if (attemptsBefore !== undefined) {
    trackUpgradeEvent(UpgradeEventName.PAYWALL_CONTINUED_EDITING, attemptTrackingPayload)
  } else {
    trackUpgradeEvent(UpgradeEventName.PAYWALL_CONTINUED_EDITING)
  }

  emit('continueEditing')

  if (attemptsBefore !== undefined) {
    const phase2Payload = {
      ...(props.actionType !== undefined ? { action_type: props.actionType } : {}),
      ...attemptTrackingPayload,
      ...getUpgradeContext(),
    }
    trackUpgradeEvent(UpgradeEventName.PAYWALL_CONTINUE_USED, phase2Payload)
    if (attemptsAfter === 0) {
      trackUpgradeEvent(UpgradeEventName.PAYWALL_ATTEMPTS_EXHAUSTED, phase2Payload)
    }
  }
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

const tracking = useUpgradeTracking(() => props.visible, () => emit('close'), () => props.actionType)

const draftExpanded = ref(false)
const extensionRequestStatus = ref('')
const canContinueEditing = computed(() => props.remainingContinueAttempts === undefined || props.remainingContinueAttempts > 0)
const continueButtonCopy = computed(() => {
  const attempts = props.remainingContinueAttempts ?? 0
  if (props.remainingContinueAttempts === undefined) return 'Continue editing without upgrading'
  return `Continue editing without upgrading (${attempts})`
})
const continueAttemptsTooltip = computed(() => {
  const attempts = props.remainingContinueAttempts ?? 0
  if (props.remainingContinueAttempts === undefined) return undefined
  if (attempts <= 0) return 'No continue attempts remain. Request an extension or upgrade to keep editing.'
  return `You have ${attempts} temporary continue ${attempts === 1 ? 'attempt' : 'attempts'} left before editing is blocked for you in this space.`
})
const continueButtonAriaLabel = computed(() => continueAttemptsTooltip.value || continueButtonCopy.value)

function onDraftPreviewToggle() {
  const willExpand = !draftExpanded.value
  draftExpanded.value = willExpand
  tracking.trackAdvocacyDraftPreviewToggle(willExpand)
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) {
      return false
    }
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) {
    console.warn('[paywall] failed to copy extension request details', e)
    return false
  }
}

async function onRequestExtension() {
  const requestUrl = extensionRequestUrl()
  const requestContext = buildExtensionRequestContext({
    spaceKey: messageContext.value.spaceKey,
    macroCount: props.macrosCreated,
    macrosLimit: props.macrosLimit,
    macroKind: props.macroKind,
  })
  const requestMessage = buildExtensionRequestMessage(requestContext)
  const copied = await copyToClipboard(requestMessage)

  tracking.trackExtensionRequestClick(copied, requestUrl)
  extensionRequestStatus.value = copied
    ? 'Request details copied. Paste them into the support form that opens next.'
    : 'Support form opened. Include the space key and macro count in your request.'

  await openUrl(requestUrl)
}

const modalContainer = ref<HTMLElement | null>(null)
watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    modalContainer.value?.focus()
  }
})
</script>
