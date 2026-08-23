<template>
  <Teleport to="body">
    <div ref="modalContainer" v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center p-4" tabindex="-1" @keydown.esc="tracking.handleClose">
      <!-- Backdrop. 75% opacity (was 50%) so the editor underneath is dimmed
           enough to recede as context, not distract from the modal. -->
      <div class="fixed inset-0 bg-black bg-opacity-75" @click="tracking.handleClose"></div>

      <!-- Modal content - Optimized for 700×600px iframe -->
      <div class="relative bg-white rounded-lg shadow-xl w-[680px] max-h-[660px] overflow-y-auto">
        <!-- Header. First beat is the investment mirror (paywall-rhythm W2):
             recognition of what the team built comes BEFORE the limit
             statement, so the limit reads as protecting an asset rather than
             opening with a reprimand. Space-level tier only for now
             (mirror_level: 'space') — personal/team tiers arrive with the
             /api/user-diagram-stats endpoint. -->
        <div class="px-4 py-2 border-b border-gray-200">
          <p
            v-if="macrosCreated > 0"
            data-testid="investment-mirror"
            class="text-xs font-medium text-emerald-800"
          >
            Your team has built {{ macrosCreated }} diagrams in this space.
          </p>
          <h2 class="text-sm font-semibold text-gray-900">
            This space has reached the ZenUML Lite limit ({{ macrosLimit }} macros).
          </h2>
          <p class="text-xs text-gray-600 mt-0.5">
            Existing diagrams still render. To create or edit, upgrade the space.
          </p>
        </div>

        <PaywallExtensionIntake
          v-if="extensionFlowOpen"
          :space-key="messageContext.spaceKey"
          :macro-count="macrosCreated"
          :attempts-remaining="remainingContinueAttempts"
          @cancel="extensionFlowOpen = false"
          @granted="onExtensionGranted"
        />

        <template v-else>

        <!-- At the last continue the modal collapses to the commitment
             question: every mid-section surface (hero, purchase card, draft,
             advocacy, extension) yields, because the three commitment options
             ARE those rails — showing both duplicates every CTA and buries
             the question ("crazily busy", review 2026-08-10). -->
        <template v-if="!isLastContinueAttempt">
        <!-- Hero: illustration + title + body -->
        <PaywallHero />

        <!-- Purchase surface. Deliberately ABOVE the advocacy draft: the first
             thing offered should be a way to fix this yourself, not a way to ask
             someone else. Between 2026-05-12 (05b5287f, which deleted the
             pricing cards) and this change the modal had NO purchase path at
             all — the Marketplace URL and the price appeared only inside the
             copied message. Rails are ordered by who can actually complete
             them: the bundle needs nobody, Marketplace needs a site admin. -->
        <div class="px-4 pb-3">
          <div class="rounded-md border border-gray-200 bg-white px-3 py-2.5">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs font-medium text-gray-900 leading-5">
                  Unlock this space for your whole team
                </p>
                <p class="text-[11px] text-gray-600 leading-4">
                  {{ ENTERPRISE_BUNDLE_PRICE }} · pay by card, no Confluence admin needed.
                  Editing resumes instantly — your diagrams stay.
                </p>
              </div>
              <button
                data-testid="unlock-space-btn"
                class="shrink-0 rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-1"
                @click="onUnlockSpace"
              >Unlock this space — {{ ENTERPRISE_BUNDLE_PRICE }}</button>
            </div>
            <p class="mt-1.5 border-t border-gray-100 pt-1.5 text-[11px] text-gray-600 leading-4">
              Have more than one space over the limit?
              <button
                data-testid="marketplace-cta"
                class="text-blue-600 hover:text-blue-800 hover:underline"
                @click="onViewMarketplacePlan"
              >Compare the Full plan →</button>
              <span class="text-gray-500">Covers every space; a Confluence site admin has to approve it.</span>
            </p>
          </div>
        </div>

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
                Need to finish the work in front of you? Answer five short questions for a one-time 7-day extension.
              </p>
              <button
                data-testid="request-extension-btn"
                class="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                @click="onRequestExtension"
              >Get a 7-day extension</button>
            </div>
          </div>
        </div>
        </template>

        <!-- Last-continue commitment beat (paywall-rhythm W1). Only degrees of
             yes: unlock now, route the request to an admin, or spend the final
             attempt. Rendered ABOVE the footer so the three options read as
             the modal's closing question, not footer chrome. -->
        <div
          v-if="isLastContinueAttempt"
          data-testid="commitment-prompt"
          class="px-6 py-8"
        >
          <p class="text-sm font-semibold text-gray-900">
            This is your last continue.
          </p>
          <p class="mt-1 text-sm text-gray-700">
            Keep this space's diagram work uninterrupted?
          </p>
          <div class="mt-4 flex flex-col gap-2">
            <button
              data-testid="commitment-unlock-btn"
              class="w-full rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
              @click="onCommitmentAnswer('unlock')"
            >Unlock now — {{ ENTERPRISE_BUNDLE_PRICE }} · editing resumes instantly</button>
            <button
              data-testid="commitment-ask-admin-btn"
              class="w-full rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
              @click="onCommitmentAnswer('ask_admin')"
            >Ask your admin — copy the request (includes numbers and price)</button>
          </div>
          <p
            v-if="commitmentStatus"
            class="mt-2 text-xs text-gray-600"
            data-testid="commitment-status"
          >{{ commitmentStatus }}</p>
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
              @click="isLastContinueAttempt ? onCommitmentAnswer('continue_last') : onContinueEditing()"
            >{{ continueButtonCopy }}</button>
            <span
              v-else
              data-testid="continue-attempts-exhausted"
              class="text-xs text-gray-500"
              :title="continueAttemptsTooltip"
              :aria-label="continueButtonAriaLabel"
            >Your diagrams are safe — request an extension above to resume editing.</span>
          </div>
          <!-- @click.prevent + openUrl, NOT a bare target="_blank": the Forge
               Custom UI iframe sandbox has no allow-popups, so the browser
               silently drops plain anchor navigations. router.open (inside
               openUrl) is the only working outbound path. -->
          <a
            href="https://zenuml.com/upgrade/"
            target="_blank"
            rel="noopener noreferrer"
            class="shrink-0 text-xs text-blue-600 hover:text-blue-800 hover:underline"
            @click.prevent="onLearnMore"
          >
            Why do I need to upgrade? →
          </a>
        </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import PaywallHero from './PaywallHero.vue'
import DraftCard from './DraftCard.vue'
import AdvocacyButton from './AdvocacyButton.vue'
import PaywallExtensionIntake from './PaywallExtensionIntake.vue'
import { useUpgradeTracking } from './useUpgradeTracking'
import { trackUpgradeEvent, UpgradeEventName, UIComponent, bundleClientReferenceId } from '@/utils/upgradeTracking'
import type { PaywallActionType } from '@/utils/paywall/mountPaywallGate'
import { CONTINUE_ATTEMPTS_STORAGE_SOURCE } from '@/utils/paywall/continueAttempts'
import { getUpgradeContext, useCustomerSuccessService } from '@/composables/useCustomerSuccessService'
import {
  buildAdvocacyMessage,
  type AdvocacyMessageContext,
  type MacroKind,
} from './buildAdvocacyMessage'
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
  (e: 'extensionGranted', expiresAt: string): void
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
const extensionFlowOpen = ref(false)
const commitmentStatus = ref('')
const canContinueEditing = computed(() => props.remainingContinueAttempts === undefined || props.remainingContinueAttempts > 0)
const isLastContinueAttempt = computed(() => props.remainingContinueAttempts === 1)
// Tiered copy (paywall-rhythm W1): full allowance stays neutral, the
// second-to-last carries the loss preview, the last is the commitment beat.
// Every tier keeps the literal 'Continue editing' substring — E2E helpers and
// the smoke-test skill locate this button by that text.
const continueButtonCopy = computed(() => {
  const attempts = props.remainingContinueAttempts
  if (attempts === undefined) return 'Continue editing without upgrading'
  if (attempts === 1) return 'Continue editing (last time)'
  if (attempts === 2) return 'Continue editing (2 left) — after that, new edits pause'
  return `Continue editing without upgrading (${attempts})`
})
const continueAttemptsTooltip = computed(() => {
  const attempts = props.remainingContinueAttempts ?? 0
  if (props.remainingContinueAttempts === undefined) return undefined
  if (attempts <= 0) return 'No continue attempts remain. Your diagrams still render; request an extension or upgrade to keep editing.'
  return `You have ${attempts} temporary continue ${attempts === 1 ? 'attempt' : 'attempts'} left before editing is blocked for you in this space.`
})
const continueButtonAriaLabel = computed(() => continueAttemptsTooltip.value || continueButtonCopy.value)

/** Route a commitment-prompt answer (last-continue beat). Tracks the answer,
 *  then reuses the existing rail handlers so each path behaves exactly like
 *  its standalone control. */
async function onCommitmentAnswer(answer: 'unlock' | 'ask_admin' | 'continue_last') {
  trackUpgradeEvent(UpgradeEventName.PAYWALL_COMMITMENT_ANSWERED, {
    commitment_answer: answer,
    ...purchaseContext(),
  })
  if (answer === 'unlock') {
    await onUnlockSpace()
    return
  }
  if (answer === 'ask_admin') {
    const copied = await copyToClipboard(message.value)
    commitmentStatus.value = copied
      ? 'Request copied — paste it to your admin. It includes the space numbers and both upgrade options.'
      : 'Copy failed — use "Copy upgrade request" below; it contains the same message.'
    return
  }
  onContinueEditing()
}

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

/** Shared context for both purchase rails, so a rail comparison is apples to
 *  apples. `ui_component: 'modal'` is what separates these from the page-banner
 *  emissions of the same events. */
function purchaseContext() {
  return {
    ...(props.actionType !== undefined ? { action_type: props.actionType } : {}),
    ui_component: UIComponent.MODAL,
    space_key: messageContext.value.spaceKey,
    // Which investment-mirror tier this modal rendered with (paywall-rhythm
    // W2). Space-level is the only tier until /api/user-diagram-stats ships.
    mirror_level: 'space' as const,
    ...getUpgradeContext(),
  }
}

/** Enterprise Bundle rail — per-space, card payment, completable by anyone.
 *  This is the primary CTA precisely because it requires no permission the
 *  person in front of the modal might not have. */
async function onUnlockSpace() {
  const reference = bundleClientReferenceId(props.enterpriseBundleUrl)
  trackUpgradeEvent(UpgradeEventName.PAYWALL_BUNDLE_CTA_CLICKED, {
    bundle_price_usd: ENTERPRISE_BUNDLE_ANNUAL_COST,
    ...(reference !== undefined ? { client_reference_id: reference } : {}),
    ...purchaseContext(),
  })
  await openUrl(props.enterpriseBundleUrl)
}

/** Marketplace (Full plan) rail — covers every space, but only a Confluence
 *  site admin can complete it. Tracked separately so we can tell "wanted to buy
 *  but lacked the rights" apart from "did not want to buy". */
async function onViewMarketplacePlan() {
  trackUpgradeEvent(UpgradeEventName.PAYWALL_MARKETPLACE_CTA_CLICKED, purchaseContext())
  await openUrl(props.upgradeUrl)
}

async function onLearnMore() {
  trackUpgradeEvent(UpgradeEventName.PAYWALL_LEARN_MORE_CLICKED, purchaseContext())
  await openUrl('https://zenuml.com/upgrade/')
}

async function onRequestExtension() {
  extensionFlowOpen.value = true
  trackUpgradeEvent(UpgradeEventName.PAYWALL_EXTENSION_STARTED, {
    feature_area: 'upgrade',
    surface: 'modal',
    entry_source: 'paywall_modal',
    attempts_remaining: props.remainingContinueAttempts ?? 0,
    ...getUpgradeContext(),
  })
}

function onExtensionGranted(expiresAt: string) {
  customerSuccess?.activateUserExtension?.(expiresAt)
  emit('extensionGranted', expiresAt)
}

const modalContainer = ref<HTMLElement | null>(null)
watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    modalContainer.value?.focus()
  }
})
</script>
