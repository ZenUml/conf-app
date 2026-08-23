<template>
  <section class="px-5 py-4" data-testid="extension-intake">
    <template v-if="result?.status === 'granted'">
      <div class="rounded-lg border border-emerald-200 bg-emerald-50 p-5" data-testid="extension-granted">
        <p class="text-xs font-semibold uppercase tracking-wide text-emerald-700">7-day extension active</p>
        <h3 class="mt-1 text-lg font-semibold text-gray-950">You can keep editing this Space.</h3>
        <p class="mt-2 text-sm text-gray-700">
          Your access ends at
          <time class="font-semibold" :datetime="result.grant.expiresAt" data-testid="extension-expiry">
            {{ formatExpiry(result.grant.expiresAt) }}
          </time>.
          Replayed submissions keep this same expiry.
        </p>
        <button
          class="mt-4 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
          data-testid="extension-return-editor"
          @click="$emit('granted', result.grant.expiresAt)"
        >Return to editing</button>
      </div>
    </template>

    <template v-else-if="result?.status === 'manual_review'">
      <div class="rounded-lg border border-amber-200 bg-amber-50 p-5" data-testid="extension-manual-review">
        <p class="text-xs font-semibold uppercase tracking-wide text-amber-800">Request received</p>
        <h3 class="mt-1 text-lg font-semibold text-gray-950">This request needs manual review.</h3>
        <p class="mt-2 text-sm text-gray-700">
          A previous automatic extension already exists for you in this Space. We recorded this request,
          but no additional access or expiry was promised.
        </p>
        <button
          class="mt-4 text-sm font-medium text-gray-700 underline"
          data-testid="extension-manual-close"
          @click="$emit('cancel')"
        >Back to upgrade options</button>
      </div>
    </template>

    <template v-else>
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-blue-700">About one minute · Question {{ step + 1 }} of 3</p>
          <h3 class="mt-1 text-base font-semibold text-gray-950">Get a 7-day extension</h3>
        </div>
        <button class="text-xs text-gray-500 hover:text-gray-800" @click="$emit('cancel')">Cancel</button>
      </div>

      <p class="mt-3 rounded border border-blue-100 bg-blue-50 p-2.5 text-xs leading-5 text-blue-950" data-testid="extension-disclosure">
        If this is your first eligible request, your 7-day access starts as soon as you submit. Your answers do not affect whether you qualify.
        ZenUML may notify your organisation's registered technical or site contact. That message contains only this Space, its approximate diagram count,
        and the scope and timing you select below. Your optional product-research answer is not shared with your organisation.
      </p>

      <div class="mt-4 min-h-[245px]" :data-testid="`extension-question-${step + 1}`">
        <fieldset v-if="step === 0">
          <legend class="text-sm font-semibold text-gray-900">1. What access does your team need beyond these 7 days?</legend>
          <OptionList v-model="answers.unblockNeed.scope" name="extension-scope" :options="scopeOptions" />
          <p class="mt-2 text-xs leading-4 text-gray-500">
            This helps us suggest the right long-term option to your admin. Your own 7-day access is the same whichever you pick.
          </p>
        </fieldset>

        <fieldset v-else-if="step === 1">
          <legend class="text-sm font-semibold text-gray-900">2. When do you need this diagram work done?</legend>
          <OptionList v-model="answers.unblockNeed.urgency" name="extension-urgency" :options="urgencyOptions" />
          <p class="mt-2 text-xs leading-4 text-gray-500">Included in the admin message so they can prioritise.</p>
        </fieldset>

        <fieldset v-else>
          <legend class="text-sm font-semibold text-gray-900">3. Optional: do you use AI tools to create or edit diagrams?</legend>
          <OptionList v-model="answers.aiDiagramUse" name="ai-diagram-use" :options="aiDiagramUseOptions" />
          <p class="mt-2 text-xs leading-4 text-gray-500">Product research only. Never shared with your organisation.</p>
        </fieldset>
      </div>

      <p v-if="errorMessage" class="mb-2 rounded bg-red-50 p-2 text-xs text-red-800" data-testid="extension-error">{{ errorMessage }}</p>
      <div class="flex items-center justify-between border-t border-gray-100 pt-3">
        <button
          class="text-sm font-medium text-gray-600 disabled:opacity-40"
          data-testid="extension-back"
          :disabled="submitting"
          @click="step === 0 ? $emit('cancel') : goBack()"
        >Back</button>
        <div class="flex items-center gap-3">
          <button
            v-if="step === 2"
            class="text-sm font-medium text-gray-600 underline disabled:opacity-40"
            data-testid="extension-skip"
            :disabled="submitting"
            @click="skipAiQuestion"
          >Skip</button>
          <button
            class="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="extension-next"
            :disabled="!canAdvance || submitting"
            @click="advance"
          >{{ submitting ? 'Submitting…' : step === 2 ? 'Start my 7 days' : 'Next' }}</button>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref, type PropType } from 'vue';
import { trackUpgradeEvent, UpgradeEventName } from '@/utils/upgradeTracking';
import {
  submitPaywallExtension,
  type ExtensionUrgencyV2,
  type PaywallExtensionAnswers,
  type PaywallExtensionResponse,
  type PaywallExtensionSubmissionV2,
  type SubmitPaywallExtension,
} from '@/utils/paywall/paywallExtension';

type Option = { value: string; label: string };

const OptionList = defineComponent({
  name: 'PaywallExtensionOptionList',
  props: {
    modelValue: String,
    name: { type: String, required: true },
    options: { type: Array as PropType<Option[]>, required: true },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('div', {
      class: 'mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2',
    }, props.options.map((option) => h('label', {
      class: 'flex cursor-pointer items-center gap-2 rounded border border-gray-200 px-2.5 py-2 text-xs hover:bg-gray-50',
    }, [
      h('input', {
        type: 'radio',
        name: props.name,
        value: option.value,
        checked: props.modelValue === option.value,
        onChange: () => emit('update:modelValue', option.value),
      }),
      option.label,
    ])));
  },
});

const props = withDefaults(defineProps<{
  spaceKey: string;
  macroCount: number;
  attemptsRemaining?: number;
  submitRequest?: SubmitPaywallExtension;
}>(), {
  attemptsRemaining: 0,
  submitRequest: submitPaywallExtension,
});

defineEmits<{
  (event: 'cancel'): void;
  (event: 'granted', expiresAt: string): void;
}>();

const scopeOptions: Option[] = [
  ['self', 'Just me, in this Space'],
  ['space', 'Several people in this Space'],
  ['site', 'Multiple Spaces across our site'],
  ['not_sure', 'Not sure yet'],
].map(([value, label]) => ({ value, label }));
const urgencyOptions: Option[] = [
  ['today', 'Today'],
  ['this_week', 'This week'],
  ['no_hard_deadline', 'No hard deadline'],
].map(([value, label]) => ({ value, label }));
const aiDiagramUseOptions: Option[] = [
  ['regularly', 'Yes, regularly'],
  ['occasionally', 'Yes, occasionally'],
  ['interested', 'No, but I’d like to'],
  ['no', 'No'],
].map(([value, label]) => ({ value, label }));

const questionIds = ['long_term_access', 'urgency', 'ai_diagram_use'] as const;
const step = ref(0);
const submitting = ref(false);
const errorMessage = ref('');
const result = ref<PaywallExtensionResponse>();
const stepStartedAt = ref(Date.now());
const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `extension-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const answers = ref<PaywallExtensionAnswers>({
  unblockNeed: {},
});

const canAdvance = computed(() => [
  Boolean(answers.value.unblockNeed.scope),
  Boolean(answers.value.unblockNeed.urgency),
  true,
][step.value]);

function goBack() {
  step.value -= 1;
  stepStartedAt.value = Date.now();
}

function selectedOptionPosition(options: Option[], value: string | undefined): number | undefined {
  if (!value) return undefined;
  const index = options.findIndex((option) => option.value === value);
  return index < 0 ? undefined : index + 1;
}

function trackAnswer(answerSkipped = false) {
  const common = {
    questionnaire_version: 2 as const,
    question_id: questionIds[step.value],
    step_index: step.value + 1,
    answer_skipped: answerSkipped,
    time_on_step_ms: Math.max(0, Date.now() - stepStartedAt.value),
  };
  if (step.value === 0) {
    trackUpgradeEvent(UpgradeEventName.PAYWALL_EXTENSION_QUESTION_ANSWERED, {
      ...common,
      extension_scope: answers.value.unblockNeed.scope,
      option_position: selectedOptionPosition(scopeOptions, answers.value.unblockNeed.scope),
    });
  } else if (step.value === 1) {
    trackUpgradeEvent(UpgradeEventName.PAYWALL_EXTENSION_QUESTION_ANSWERED, {
      ...common,
      urgency: answers.value.unblockNeed.urgency,
      option_position: selectedOptionPosition(urgencyOptions, answers.value.unblockNeed.urgency),
    });
  } else {
    trackUpgradeEvent(UpgradeEventName.PAYWALL_EXTENSION_QUESTION_ANSWERED, {
      ...common,
      ...(answerSkipped ? {} : { ai_diagram_use: answers.value.aiDiagramUse }),
      ...(answerSkipped ? {} : { option_position: selectedOptionPosition(aiDiagramUseOptions, answers.value.aiDiagramUse) }),
    });
  }
}

function submissionAnswers(): PaywallExtensionSubmissionV2['answers'] | undefined {
  const { scope, urgency } = answers.value.unblockNeed;
  if (!scope || !urgency) return undefined;
  return {
    unblockNeed: { scope, urgency: urgency as ExtensionUrgencyV2 },
    ...(answers.value.aiDiagramUse ? { aiDiagramUse: answers.value.aiDiagramUse } : {}),
  };
}

async function submit() {
  const submission = submissionAnswers();
  if (!submission) return;

  submitting.value = true;
  errorMessage.value = '';
  try {
    const response = await props.submitRequest({
      spaceKey: props.spaceKey,
      macroCount: props.macroCount,
      idempotencyKey,
      questionnaireVersion: 2,
      answers: submission,
    });
    result.value = response;
    if (response.adminContactRouting) {
      const route = response.adminContactRouting;
      trackUpgradeEvent(UpgradeEventName.PAYWALL_ADMIN_CONTACT_ROUTED, {
        routing_outcome: route.routingOutcome === 'manual' ? 'manual_review' : route.routingOutcome,
        reason_codes: route.reasonCodes.join('|'),
        ...(route.cacheAgeHours == null ? {} : { cache_age_hours: route.cacheAgeHours }),
        override_used: route.overrideUsed,
      });
    }
    if (response.status === 'granted') {
      trackUpgradeEvent(UpgradeEventName.PAYWALL_EXTENSION_GRANTED, {
        questionnaire_version: 2,
        outcome: response.isReplay ? 'replay' : 'created',
        extension_scope: answers.value.unblockNeed.scope,
        urgency: answers.value.unblockNeed.urgency,
        extension_days: 7,
        is_replay: response.isReplay,
      });
    } else {
      trackUpgradeEvent(UpgradeEventName.PAYWALL_EXTENSION_REPEAT_REQUESTED, {
        questionnaire_version: 2,
        extension_scope: answers.value.unblockNeed.scope,
        urgency: answers.value.unblockNeed.urgency,
        prior_grant_count: response.priorGrantCount,
        routing_outcome: 'manual_review',
      });
    }
  } catch {
    errorMessage.value = 'We could not submit the request. Your answers are still here; try again.';
  } finally {
    submitting.value = false;
  }
}

async function advance() {
  if (!canAdvance.value || submitting.value) return;
  if (step.value < 2) {
    trackAnswer();
    step.value += 1;
    stepStartedAt.value = Date.now();
    return;
  }
  // The optional question can be submitted with the primary CTA as well as
  // with Skip. In both cases, an unanswered field is recorded as skipped and
  // remains absent from the request.
  trackAnswer(!answers.value.aiDiagramUse);
  await submit();
}

async function skipAiQuestion() {
  if (submitting.value) return;
  // Skipping must remain an actual omission in the request; never infer an AI
  // answer from the operational scope or urgency selections.
  answers.value.aiDiagramUse = undefined;
  trackAnswer(true);
  await submit();
}

function formatExpiry(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}
</script>
