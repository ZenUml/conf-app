<template>
  <div class="px-4 pb-3" data-testid="paywall-survey">
    <p class="text-xs text-gray-700 leading-5">{{ intro }}</p>

    <!-- Q1: who is answering. Long labels, so one per line. -->
    <fieldset class="mt-2.5">
      <legend class="text-xs font-medium text-gray-900">{{ ROLE_QUESTION_LABEL }}</legend>
      <div class="mt-1 flex flex-col gap-0.5">
        <label
          v-for="option in ROLE_OPTIONS"
          :key="option.value"
          class="flex items-center gap-1.5 text-[11px] text-gray-700 leading-4 cursor-pointer"
        >
          <input
            type="radio"
            name="paywall-survey-role"
            class="h-3 w-3 shrink-0 accent-blue-600"
            :data-testid="`survey-role-${option.value}`"
            :value="option.value"
            :checked="answers.role === option.value"
            @change="onRoleChange(option.value)"
          />
          <span>{{ option.label }}</span>
        </label>
      </div>
    </fieldset>

    <!-- Q2: the four Van Westendorp price points. -->
    <fieldset class="mt-2.5">
      <legend class="text-xs font-medium text-gray-900">{{ priceQuestionLabel }}</legend>
      <div class="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
        <label
          v-for="field in PRICE_FIELDS"
          :key="field.key"
          class="flex items-center justify-between gap-2 text-[11px] text-gray-700 leading-4"
        >
          <span class="min-w-0">{{ field.label }}</span>
          <span class="flex shrink-0 items-center gap-1">
            <span class="text-gray-500">$</span>
            <input
              type="number"
              min="0"
              :max="SURVEY_MAX_PRICE_USD"
              step="1"
              inputmode="numeric"
              class="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              :data-testid="field.testId"
              :value="answers[field.key] ?? ''"
              @input="onPriceInput(field, $event)"
            />
          </span>
        </label>
      </div>
      <p
        v-if="!priceOrderOk"
        class="mt-1 text-[11px] text-red-600 leading-4"
        data-testid="survey-price-error"
      >{{ PRICE_ORDER_ERROR }}</p>
    </fieldset>

    <!-- Q3: best and worst pricing unit. Rendered as one grid so the two
         choices stay comparable instead of two stacked lists of the same
         four options. -->
    <fieldset class="mt-2.5">
      <legend class="text-xs font-medium text-gray-900">{{ UNIT_QUESTION_LABEL }}</legend>
      <div class="mt-1">
        <div class="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 text-[11px] text-gray-500 leading-4">
          <span></span>
          <span class="w-14 text-center">{{ UNIT_MOST_LABEL }}</span>
          <span class="w-14 text-center">{{ UNIT_LEAST_LABEL }}</span>
        </div>
        <div
          v-for="option in UNIT_OPTIONS"
          :key="option.value"
          class="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 text-[11px] text-gray-700 leading-5"
        >
          <span class="min-w-0">{{ option.label }}</span>
          <span class="w-14 text-center">
            <input
              type="radio"
              name="paywall-survey-unit-most"
              class="h-3 w-3 accent-blue-600"
              :data-testid="`survey-unit-most-${option.value}`"
              :value="option.value"
              :checked="answers.unitMost === option.value"
              @change="onUnitMostChange(option.value)"
            />
          </span>
          <span class="w-14 text-center">
            <input
              type="radio"
              name="paywall-survey-unit-least"
              class="h-3 w-3 accent-blue-600 disabled:opacity-40"
              :data-testid="`survey-unit-least-${option.value}`"
              :value="option.value"
              :checked="answers.unitLeast === option.value"
              :disabled="answers.unitMost === option.value"
              @change="onUnitLeastChange(option.value)"
            />
          </span>
        </div>
      </div>
    </fieldset>

    <!-- Q4: the internal blocker. Short labels, so they wrap inline. -->
    <fieldset class="mt-2.5">
      <legend class="text-xs font-medium text-gray-900">{{ BLOCKER_QUESTION_LABEL }}</legend>
      <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        <label
          v-for="option in BLOCKER_OPTIONS"
          :key="option.value"
          class="flex items-center gap-1.5 text-[11px] text-gray-700 leading-4 cursor-pointer"
        >
          <input
            type="radio"
            name="paywall-survey-blocker"
            class="h-3 w-3 shrink-0 accent-blue-600"
            :data-testid="`survey-blocker-${option.value}`"
            :value="option.value"
            :checked="answers.blocker === option.value"
            @change="onBlockerChange(option.value)"
          />
          <span>{{ option.label }}</span>
        </label>
      </div>
    </fieldset>

    <!-- Optional free text. Never leaves this component except in the request
         body: the answered event deliberately carries no comment value. -->
    <label class="mt-2.5 flex items-center gap-2">
      <span class="shrink-0 text-xs font-medium text-gray-900">{{ COMMENT_QUESTION_LABEL }}</span>
      <input
        type="text"
        :maxlength="SURVEY_COMMENT_MAX_LENGTH"
        data-testid="survey-comment"
        class="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        :value="answers.comment ?? ''"
        @input="onCommentInput($event)"
      />
    </label>

    <p
      v-if="errorMessage"
      class="mt-2 rounded border border-red-100 bg-red-50 px-2 py-1 text-[11px] text-red-700 leading-4"
      data-testid="survey-error"
    >{{ errorMessage }}</p>

    <div class="mt-3 flex items-center justify-between gap-3">
      <button
        type="button"
        data-testid="survey-submit-btn"
        class="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-1 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
        :disabled="!canSubmit"
        @click="onSubmit"
      >{{ submitting ? SUBMIT_BUTTON_PENDING_LABEL : SUBMIT_BUTTON_LABEL }}</button>
      <button
        type="button"
        data-testid="survey-skip-btn"
        class="text-[11px] text-gray-600 hover:text-gray-800 hover:underline"
        @click="onSkip"
      >{{ SKIP_BUTTON_LABEL }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { trackUpgradeEvent, UpgradeEventName, UIComponent } from '@/utils/upgradeTracking'
import { getUpgradeContext } from '@/composables/useCustomerSuccessService'
import { callRemote } from '@/utils/requestUtil'
import type { PaywallActionType } from '@/utils/paywall/mountPaywallGate'
import type { PaywallSurveyGrant, PaywallSurveyQuestion } from '@/utils/analytics/catalog'
import {
  BLOCKER_OPTIONS,
  BLOCKER_QUESTION_LABEL,
  COMMENT_QUESTION_LABEL,
  PARTIAL_SAVE_DEBOUNCE_MS,
  PRICE_FIELDS,
  PRICE_ORDER_ERROR,
  PRICE_QUESTION_LABEL,
  ROLE_OPTIONS,
  ROLE_QUESTION_LABEL,
  SKIP_BUTTON_LABEL,
  SUBMIT_BUTTON_LABEL,
  SUBMIT_BUTTON_PENDING_LABEL,
  SUBMIT_ERROR_MESSAGE,
  SURVEY_COMMENT_MAX_LENGTH,
  SURVEY_ENDPOINT,
  SURVEY_INTRO,
  SURVEY_MAX_PRICE_USD,
  SURVEY_QUESTION_BLOCKER,
  SURVEY_QUESTION_COMMENT,
  SURVEY_QUESTION_ROLE,
  SURVEY_QUESTION_UNIT_LEAST,
  SURVEY_QUESTION_UNIT_MOST,
  SURVEY_REWARD_DAYS,
  UNIT_LEAST_LABEL,
  UNIT_MOST_LABEL,
  UNIT_OPTIONS,
  UNIT_QUESTION_LABEL,
  buildSurveyPayload,
  isSurveyComplete,
  newSurveyResponseId,
  priceOrderValid,
  type SurveyAnswers,
  type SurveyBlocker,
  type SurveyPriceField,
  type SurveyRole,
  type SurveyUnit,
} from './paywallSurvey'

const props = defineProps<{
  spaceKey: string
  macroCount: number
  actionType?: PaywallActionType
}>()

const emit = defineEmits<{
  (e: 'submitted', result: { grant: PaywallSurveyGrant; expiresAt?: string; responseId: string }): void
  (e: 'skipped', responseId: string): void
}>()

const answers = reactive<SurveyAnswers>({})
const submitting = ref(false)
const errorMessage = ref('')
const responseId = ref('')

const intro = computed(() => SURVEY_INTRO(props.spaceKey))
const priceQuestionLabel = computed(() => PRICE_QUESTION_LABEL(props.spaceKey))
const priceOrderOk = computed(() => priceOrderValid(answers))
const complete = computed(() => isSurveyComplete(answers))
const canSubmit = computed(() => complete.value && !submitting.value)

/** Same shape as UpgradePrompt's purchaseContext(), so a survey event can be
 *  joined to the modal events that surround it. */
function surveyContext() {
  return {
    ...(props.actionType !== undefined ? { action_type: props.actionType } : {}),
    ui_component: UIComponent.MODAL,
    space_key: props.spaceKey,
    survey_reward_days: SURVEY_REWARD_DAYS,
    ...getUpgradeContext(),
  }
}

function trackAnswered(question: PaywallSurveyQuestion, value?: string | number) {
  trackUpgradeEvent(UpgradeEventName.PAYWALL_SURVEY_ANSWERED, {
    survey_question: question,
    ...(typeof value === 'number' ? { survey_answer_number: value } : {}),
    ...(typeof value === 'string' ? { survey_answer: value } : {}),
    ...surveyContext(),
  })
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Questions whose paywall_survey_answered event is still owed to the next
 *  flush. Price and comment questions defer their event to the same debounce
 *  as the partial save (see onPriceInput/onCommentInput) instead of tracking
 *  on every keystroke. That used to be done with a closure passed to
 *  schedulePartialSave() as `onFlush` - but a second field edited inside the
 *  same debounce window called schedulePartialSave() again, which cancelled
 *  the pending timer *and* discarded the first field's closure with it, so
 *  only the last-edited field's event ever fired. Keying by question instead
 *  lets edits to different fields coexist in the same window: each `.set()`
 *  just updates that question's entry, and the flush below walks the whole
 *  map. For price questions the value is the latest accepted number; the
 *  comment question is always recorded as undefined since its event never
 *  carries the text. */
const pendingAnswered = new Map<PaywallSurveyQuestion, number | undefined>()

function cancelPendingSave() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

function payload(submitted: boolean) {
  return buildSurveyPayload({
    responseId: responseId.value,
    spaceKey: props.spaceKey,
    macroCount: props.macroCount,
    appVersion: import.meta.env.VITE_APP_VERSION,
    answers,
    submitted,
  })
}

/** Emits the paywall_survey_answered event for every question recorded in
 *  pendingAnswered since the last flush, then clears the map. Called from the
 *  debounced timer and, so a fast submit/skip mid-debounce cannot drop the
 *  last price or comment event, from onSubmit/onSkip directly. */
function flushPendingAnswered() {
  for (const [question, value] of pendingAnswered) {
    trackAnswered(question, value)
  }
  pendingAnswered.clear()
}

/** Best effort only: a dropped partial save costs one incomplete row, so a
 *  failure must never surface as an error the user has to act on. Flushes
 *  pendingAnswered just before the write, so every question touched during
 *  the debounce window gets its answered event exactly once. */
function schedulePartialSave() {
  cancelPendingSave()
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushPendingAnswered()
    void callRemote(SURVEY_ENDPOINT, 'POST', payload(false)).catch((e) => {
      console.warn('[paywall-survey] partial save failed', e)
    })
  }, PARTIAL_SAVE_DEBOUNCE_MS)
}

function onRoleChange(value: SurveyRole) {
  answers.role = value
  trackAnswered(SURVEY_QUESTION_ROLE, value)
  schedulePartialSave()
}

function onUnitMostChange(value: SurveyUnit) {
  answers.unitMost = value
  // The same unit cannot be both best and worst; clear the conflicting pick
  // rather than leave an impossible pair on screen.
  if (answers.unitLeast === value) answers.unitLeast = undefined
  trackAnswered(SURVEY_QUESTION_UNIT_MOST, value)
  schedulePartialSave()
}

function onUnitLeastChange(value: SurveyUnit) {
  if (answers.unitMost === value) return
  answers.unitLeast = value
  trackAnswered(SURVEY_QUESTION_UNIT_LEAST, value)
  schedulePartialSave()
}

function onBlockerChange(value: SurveyBlocker) {
  answers.blocker = value
  trackAnswered(SURVEY_QUESTION_BLOCKER, value)
  schedulePartialSave()
}

/** Prices are typed, not clicked, so their answered event rides the same
 *  debounce as the save. Tracking on every keystroke would report 1, 15 and
 *  150 as three separate price answers. */
function onPriceInput(field: SurveyPriceField, event: Event) {
  const input = event.target as HTMLInputElement
  const raw = input.value.trim()
  const parsed = raw === '' ? Number.NaN : Number(raw)
  const accepted =
    Number.isFinite(parsed) && parsed >= 0
      ? Math.min(Math.floor(parsed), SURVEY_MAX_PRICE_USD)
      : undefined
  // Clamp in the field itself, not just in the model: the backend refuses a
  // price above the cap, and a 400 the user cannot read is worse than a number
  // that visibly stops growing. Written directly because a :value binding that
  // does not change between renders leaves the typed text on screen.
  if (accepted !== undefined && String(accepted) !== raw) input.value = String(accepted)
  answers[field.key] = accepted
  // A cleared/invalid field never earns an answered event (matching the old
  // `if (value !== undefined)` guard), and drops any earlier pending entry so
  // a later flush cannot resurrect a value the user has since erased.
  if (accepted !== undefined) {
    pendingAnswered.set(field.question, accepted)
  } else {
    pendingAnswered.delete(field.question)
  }
  schedulePartialSave()
}

/** The comment's TEXT is never tracked; only the fact that one was written. */
function onCommentInput(event: Event) {
  answers.comment = (event.target as HTMLInputElement).value
  pendingAnswered.set(SURVEY_QUESTION_COMMENT, undefined)
  schedulePartialSave()
}

async function onSubmit() {
  if (!canSubmit.value) return
  cancelPendingSave()
  // The debounce timer that would have flushed the last field's answered
  // event was just cancelled, not fired - flush it here so a submit that
  // follows a keystroke within PARTIAL_SAVE_DEBOUNCE_MS does not lose it.
  flushPendingAnswered()
  submitting.value = true
  errorMessage.value = ''
  try {
    const result = await callRemote(SURVEY_ENDPOINT, 'POST', payload(true))
    const grant = result?.grant as PaywallSurveyGrant
    trackUpgradeEvent(UpgradeEventName.PAYWALL_SURVEY_SUBMITTED, {
      survey_grant: grant,
      ...surveyContext(),
    })
    emit('submitted', {
      grant,
      expiresAt: result?.expiresAt,
      responseId: responseId.value,
    })
  } catch (e) {
    console.warn('[paywall-survey] submit failed', e)
    errorMessage.value = SUBMIT_ERROR_MESSAGE
    trackUpgradeEvent(UpgradeEventName.PAYWALL_SURVEY_SUBMITTED, {
      survey_grant: 'error',
      ...surveyContext(),
    })
  } finally {
    submitting.value = false
  }
}

function onSkip() {
  cancelPendingSave()
  flushPendingAnswered()
  trackUpgradeEvent(UpgradeEventName.PAYWALL_SURVEY_SKIPPED, surveyContext())
  emit('skipped', responseId.value)
}

onMounted(() => {
  responseId.value = newSurveyResponseId()
  trackUpgradeEvent(UpgradeEventName.PAYWALL_SURVEY_SHOWN, surveyContext())
})

onBeforeUnmount(cancelPendingSave)
</script>
