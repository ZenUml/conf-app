<template>
  <Teleport to="body">
    <div ref="modalContainer" v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center p-4" tabindex="-1" @keydown.esc="tracking.handleClose">
      <!-- Backdrop. 75% opacity (was 50%) so the editor underneath is dimmed
           enough to recede as context, not distract from the modal. -->
      <div class="fixed inset-0 bg-black bg-opacity-75" @click="tracking.handleClose"></div>

      <!-- Modal content - Optimized for 700×600px iframe. max-h caps at
           660px but never exceeds the viewport: a Forge editor iframe can be
           shorter than that (633px observed on staging), and the outer
           wrapper's p-4 (1rem per side) has to come out of the budget too,
           otherwise the modal clips top and bottom with no way to scroll to
           the footer. -->
      <div class="relative bg-white rounded-lg shadow-xl w-[680px] max-h-[min(660px,calc(100vh_-_2rem))] overflow-y-auto">
        <!-- Header - Factual -->
        <div class="px-4 py-2 border-b border-gray-200">
          <h2 class="text-sm font-semibold text-gray-900">
            This space has reached the ZenUML Lite limit ({{ macrosLimit }} macros).
          </h2>
          <p class="text-xs text-gray-600 mt-0.5">
            Existing diagrams still render. To create or edit, upgrade the space.
          </p>
        </div>

        <!-- Survey step: replaces the whole modal body. The header above and
             the footer below stay put so the close affordance never moves. -->
        <template v-if="step === 'survey'">
          <div class="px-4 pt-2">
            <button
              type="button"
              data-testid="survey-back-btn"
              class="text-[11px] text-gray-500 hover:text-gray-700 hover:underline"
              @click="step = 'main'"
            >&larr; Back</button>
          </div>
          <PaywallSurvey
            :space-key="messageContext.spaceKey"
            :macro-count="props.macrosCreated"
            :action-type="props.actionType"
            @submitted="onSurveySubmitted"
            @skipped="onSurveySkipped"
          />
        </template>

        <!-- Unlocked / already-granted outcomes of the survey. -->
        <div v-else-if="step === 'unlocked'" class="px-4 py-4" data-testid="survey-unlocked">
          <p class="text-sm font-medium text-gray-900">Editing is unlocked</p>
          <p class="mt-1 text-xs text-gray-700 leading-5">{{ unlockedCopy }}</p>
          <div class="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              data-testid="survey-continue-btn"
              class="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-1"
              @click="onUnlockedContinue"
            >Continue editing</button>
            <button
              type="button"
              data-testid="survey-support-btn"
              class="text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
              @click="runExtensionRequestFlow"
            >Need longer, or for the whole team? Request via support</button>
          </div>
        </div>

        <div
          v-else-if="step === 'already_granted'"
          class="px-4 py-4"
          data-testid="survey-already-granted"
        >
          <p class="text-xs text-gray-700 leading-5">
            You have already used the survey extension for this space. Request more time from support.
          </p>
          <button
            type="button"
            data-testid="survey-support-btn"
            class="mt-3 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            @click="runExtensionRequestFlow"
          >Request via support</button>
        </div>

        <template v-else>
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
                  {{ ENTERPRISE_BUNDLE_PRICE }} · pay by card, no Confluence admin needed
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
        </template>

        <!-- Footer - Continue editing + Learn more. Main step only: on the
             unlocked step a second "continue without upgrading" would spend a
             continue attempt the user has just stopped needing. -->
        <div v-if="step === 'main'" class="px-4 py-2 bg-gray-50 flex justify-between items-center gap-3">
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
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import PaywallHero from './PaywallHero.vue'
import PaywallSurvey from './PaywallSurvey.vue'
import DraftCard from './DraftCard.vue'
import AdvocacyButton from './AdvocacyButton.vue'
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
import {
  buildExtensionRequestContext,
  buildExtensionRequestMessage,
  buildExtensionRequestUrl,
} from './buildExtensionRequest'
import { ENTERPRISE_BUNDLE_ANNUAL_COST } from './upgradePrompt'
import type { PaywallSurveyGrant } from '@/utils/analytics/catalog'
import { SURVEY_REWARD_DAYS } from './paywallSurvey'
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
  /** The survey granted this user a space license, so editing may resume
   *  WITHOUT spending a continue attempt. Distinct from continueEditing for
   *  exactly that reason. */
  (e: 'unlocked'): void
}>()

/**
 * Which body the modal is showing.
 *
 * 'main'            the purchase rails + advocacy draft + support request
 * 'survey'          the pricing survey, shown instead of opening support
 * 'unlocked'        the survey earned a space license for this user
 * 'already_granted' this user already spent their one survey extension
 */
type PromptStep = 'main' | 'survey' | 'unlocked' | 'already_granted'
const step = ref<PromptStep>('main')
/** Response id of the survey the user just saw, threaded into the support
 *  request so a reply can be matched to the answers already stored. */
const surveyResponseId = ref<string | undefined>(undefined)
const grantExpiresAt = ref<string | undefined>(undefined)

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

/** Shared context for both purchase rails, so a rail comparison is apples to
 *  apples. `ui_component: 'modal'` is what separates these from the page-banner
 *  emissions of the same events. */
function purchaseContext() {
  return {
    ...(props.actionType !== undefined ? { action_type: props.actionType } : {}),
    ui_component: UIComponent.MODAL,
    space_key: messageContext.value.spaceKey,
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

/**
 * The support-request rail, unchanged from before the survey existed except
 * that it now carries the survey response id when there is one. Reached three
 * ways: skipping the survey, and both survey outcomes that still want a human.
 */
async function runExtensionRequestFlow() {
  const requestContext = buildExtensionRequestContext({
    spaceKey: messageContext.value.spaceKey,
    macroCount: props.macrosCreated,
    macrosLimit: props.macrosLimit,
    macroKind: props.macroKind,
    surveyResponseId: surveyResponseId.value,
  })
  const requestUrl = buildExtensionRequestUrl(requestContext)
  const requestMessage = buildExtensionRequestMessage(requestContext)
  // Clipboard copy is a safety net: JSM drops the prefill params if the user
  // navigates within the portal before submitting.
  const copied = await copyToClipboard(requestMessage)

  tracking.trackExtensionRequestClick(copied, requestUrl)
  extensionRequestStatus.value = copied
    ? 'Support form opened with your details pre-filled (also copied to your clipboard as backup).'
    : 'Support form opened with your details pre-filled — just confirm and submit.'

  await openUrl(requestUrl)
}

/**
 * "Request extension" no longer opens support directly. The survey is the
 * price of the extension, and it is asked BEFORE the hand-off because a user
 * who has already been sent to the service desk never comes back to answer it.
 */
function onRequestExtension() {
  step.value = 'survey'
}

function onSurveySkipped(responseId: string) {
  surveyResponseId.value = responseId
  step.value = 'main'
  void runExtensionRequestFlow()
}

function onSurveySubmitted(result: {
  grant: PaywallSurveyGrant
  expiresAt?: string
  responseId: string
}) {
  surveyResponseId.value = result.responseId
  grantExpiresAt.value = result.expiresAt
  if (result.grant === 'granted' || result.grant === 'existing') {
    // Reflect the grant locally: the license already exists server-side, so
    // the modal must not make the user wait for another space-status read.
    customerSuccess?.markSpacePaid('user_license')
    step.value = 'unlocked'
    return
  }
  if (result.grant === 'already_granted') {
    step.value = 'already_granted'
    return
  }
  // 'none' means the row was stored but no license was issued (an incomplete
  // submit the backend rejected). Fall back to the support rail rather than
  // claiming an unlock that did not happen.
  step.value = 'main'
}

function onUnlockedContinue() {
  emit('unlocked')
}

/** Local date, not the raw ISO string: the reader needs the day their editing
 *  stops, in their own calendar. */
const unlockedExpiryText = computed(() => {
  if (!grantExpiresAt.value) return `${SURVEY_REWARD_DAYS} more days`
  const parsed = new Date(grantExpiresAt.value)
  if (Number.isNaN(parsed.getTime())) return `${SURVEY_REWARD_DAYS} more days`
  return parsed.toLocaleDateString()
})

const unlockedCopy = computed(() =>
  `Editing is unlocked in ${messageContext.value.spaceKey} for you through ${unlockedExpiryText.value}. If an editor is already open, refresh the page.`
)

const modalContainer = ref<HTMLElement | null>(null)
watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    modalContainer.value?.focus()
  }
})
</script>
