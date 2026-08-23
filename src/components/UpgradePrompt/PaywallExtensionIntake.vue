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
          <p class="text-xs font-semibold uppercase tracking-wide text-blue-700">About one minute · Question {{ step + 1 }} of 5</p>
          <h3 class="mt-1 text-base font-semibold text-gray-950">Get a 7-day extension</h3>
        </div>
        <button class="text-xs text-gray-500 hover:text-gray-800" @click="$emit('cancel')">Cancel</button>
      </div>

      <p class="mt-3 rounded border border-blue-100 bg-blue-50 p-2.5 text-xs leading-5 text-blue-950" data-testid="extension-disclosure">
        ZenUML will use these answers to arrange temporary access and will notify your organisation's
        registered technical or site contact. You do not need to find or confirm their email.
      </p>

      <div class="mt-4 min-h-[245px]" :data-testid="`extension-question-${step + 1}`">
        <fieldset v-if="step === 0">
          <legend class="text-sm font-semibold text-gray-900">1. What are you working on right now?</legend>
          <OptionList v-model="answers.currentTask" name="current-task" :options="taskOptions" />
        </fieldset>

        <fieldset v-else-if="step === 1">
          <legend class="text-sm font-semibold text-gray-900">2. Who is this diagram ultimately for?</legend>
          <OptionList v-model="answers.diagramAudience" name="diagram-audience" :options="audienceOptions" />
        </fieldset>

        <fieldset v-else-if="step === 2">
          <legend class="text-sm font-semibold text-gray-900">3. Which AI tools do you use, and do you use them for diagrams?</legend>
          <p class="mt-1 text-xs text-gray-500">Choose up to five tools, then one diagram use.</p>
          <div class="mt-2 grid grid-cols-2 gap-1.5" data-testid="ai-tool-options">
            <label v-for="option in aiToolOptions" :key="option.value" class="flex items-center gap-2 rounded border border-gray-200 px-2 py-1.5 text-xs">
              <input
                type="checkbox"
                :checked="answers.aiAndDiagrams.tools.includes(option.value)"
                @change="toggleAiTool(option.value)"
              />
              {{ option.label }}
            </label>
          </div>
          <OptionList v-model="answers.aiAndDiagrams.diagramUsage" name="ai-diagram-usage" :options="aiDiagramOptions" compact />
        </fieldset>

        <fieldset v-else-if="step === 3">
          <legend class="text-sm font-semibold text-gray-900">4. What workflow constraints apply?</legend>
          <p class="mt-2 text-xs font-medium text-gray-700">Required diagram process or template</p>
          <OptionList v-model="answers.workflowConstraints.processRequirement" name="process-requirement" :options="processOptions" compact />
          <p class="mt-3 text-xs font-medium text-gray-700">Can code or related material be sent to cloud AI?</p>
          <OptionList v-model="answers.workflowConstraints.cloudAiPolicy" name="cloud-ai-policy" :options="cloudPolicyOptions" compact />
        </fieldset>

        <fieldset v-else>
          <legend class="text-sm font-semibold text-gray-900">5. What needs unblocking, and how urgent is it?</legend>
          <p class="mt-2 text-xs font-medium text-gray-700">Desired scope</p>
          <OptionList v-model="answers.unblockNeed.scope" name="extension-scope" :options="scopeOptions" compact />
          <p class="mt-3 text-xs font-medium text-gray-700">Urgency</p>
          <OptionList v-model="answers.unblockNeed.urgency" name="extension-urgency" :options="urgencyOptions" compact />
          <p class="mt-2 text-[11px] leading-4 text-gray-500">
            The first temporary grant is only for you in this Space. Scope helps us route the longer-term upgrade path.
          </p>
        </fieldset>
      </div>

      <p v-if="errorMessage" class="mb-2 rounded bg-red-50 p-2 text-xs text-red-800" data-testid="extension-error">{{ errorMessage }}</p>
      <div class="flex items-center justify-between border-t border-gray-100 pt-3">
        <button
          class="text-sm font-medium text-gray-600 disabled:opacity-40"
          data-testid="extension-back"
          :disabled="submitting"
          @click="step === 0 ? $emit('cancel') : step--"
        >Back</button>
        <button
          class="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="extension-next"
          :disabled="!canAdvance || submitting"
          @click="advance"
        >{{ submitting ? 'Submitting…' : step === 4 ? 'Start my 7 days' : 'Next' }}</button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref, type PropType } from 'vue';
import { trackUpgradeEvent, UpgradeEventName } from '@/utils/upgradeTracking';
import {
  submitPaywallExtension,
  type AiTool,
  type PaywallExtensionAnswers,
  type PaywallExtensionResponse,
  type PaywallExtensionSubmission,
  type SubmitPaywallExtension,
} from '@/utils/paywall/paywallExtension';

type Option = { value: string; label: string };

const OptionList = defineComponent({
  name: 'PaywallExtensionOptionList',
  props: {
    modelValue: String,
    name: { type: String, required: true },
    options: { type: Array as PropType<Option[]>, required: true },
    compact: Boolean,
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('div', {
      class: props.compact ? 'mt-2 grid grid-cols-2 gap-1.5' : 'mt-3 grid grid-cols-2 gap-2',
    }, props.options.map((option) => h('label', {
      class: 'flex cursor-pointer items-center gap-2 rounded border border-gray-200 px-2 py-1.5 text-xs hover:bg-gray-50',
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

const taskOptions = [
  ['architecture_design', 'Architecture / solution design'], ['design_review', 'Design review'],
  ['technical_documentation', 'Technical documentation'], ['incident_review', 'Incident review'],
  ['understand_existing_system', 'Understand an existing system'], ['team_communication', 'Team / cross-team communication'],
  ['other', 'Another work task'],
].map(([value, label]) => ({ value, label }));
const audienceOptions = [
  ['self', 'Myself'], ['development_team', 'My development team'], ['architect_tech_lead', 'Architect / Tech Lead'],
  ['manager_engineering_lead', 'Manager / engineering lead'], ['another_team', 'Another team'],
  ['security_platform_governance', 'Security / platform / governance'], ['documentation_readers', 'Broader documentation readers'],
].map(([value, label]) => ({ value, label }));
const aiToolOptions = [
  ['none', 'None'], ['github_copilot', 'GitHub Copilot'], ['cursor', 'Cursor'], ['claude_code', 'Claude Code'],
  ['chatgpt', 'ChatGPT'], ['windsurf', 'Windsurf'], ['other', 'Another tool'], ['not_sure', 'Not sure'],
].map(([value, label]) => ({ value: value as AiTool, label }));
const aiDiagramOptions = [
  ['none', 'No AI use'], ['ai_without_diagrams', 'AI, not for diagrams'], ['mermaid', 'Mermaid'],
  ['zenuml', 'ZenUML'], ['other_diagram_as_code', 'Other diagram-as-code'], ['not_sure', 'Not sure'],
].map(([value, label]) => ({ value, label }));
const processOptions = [
  ['required_template', 'Required template'], ['required_without_template', 'Required, no template'],
  ['not_required', 'No required process'], ['not_sure', 'Not sure'],
].map(([value, label]) => ({ value, label }));
const cloudPolicyOptions = [
  ['allowed', 'Allowed'], ['restricted', 'Restricted'], ['not_allowed', 'Not allowed'], ['not_sure', 'Not sure'],
].map(([value, label]) => ({ value, label }));
const scopeOptions = [['self', 'Just me'], ['space', 'This Space'], ['site', 'The whole Site']].map(([value, label]) => ({ value, label }));
const urgencyOptions = [['today', 'Today'], ['this_week', 'This week'], ['planning_ahead', 'Planning ahead']].map(([value, label]) => ({ value, label }));

const step = ref(0);
const submitting = ref(false);
const errorMessage = ref('');
const result = ref<PaywallExtensionResponse>();
const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `extension-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const answers = ref<PaywallExtensionAnswers>({
  aiAndDiagrams: { tools: [] },
  workflowConstraints: {},
  unblockNeed: {},
});

const canAdvance = computed(() => [
  Boolean(answers.value.currentTask),
  Boolean(answers.value.diagramAudience),
  answers.value.aiAndDiagrams.tools.length > 0 && Boolean(answers.value.aiAndDiagrams.diagramUsage),
  Boolean(answers.value.workflowConstraints.processRequirement && answers.value.workflowConstraints.cloudAiPolicy),
  Boolean(answers.value.unblockNeed.scope && answers.value.unblockNeed.urgency),
][step.value]);

function toggleAiTool(tool: AiTool) {
  const current = answers.value.aiAndDiagrams.tools;
  if (current.includes(tool)) {
    answers.value.aiAndDiagrams.tools = current.filter((item) => item !== tool);
    return;
  }
  if (tool === 'none' || tool === 'not_sure') {
    answers.value.aiAndDiagrams.tools = [tool];
    return;
  }
  answers.value.aiAndDiagrams.tools = current
    .filter((item) => item !== 'none' && item !== 'not_sure')
    .concat(tool)
    .slice(0, 5);
}

function trackAnswer() {
  const common = { question_id: ['current_task', 'diagram_audience', 'ai_and_diagrams', 'workflow_constraints', 'unblock_need'][step.value], step_index: step.value + 1 };
  const values = [
    { extension_task: answers.value.currentTask },
    { extension_audience: answers.value.diagramAudience },
    { ai_diagram_usage: answers.value.aiAndDiagrams.diagramUsage },
    { process_requirement: answers.value.workflowConstraints.processRequirement, cloud_ai_policy: answers.value.workflowConstraints.cloudAiPolicy },
    { extension_scope: answers.value.unblockNeed.scope, urgency: answers.value.unblockNeed.urgency },
  ][step.value];
  trackUpgradeEvent(UpgradeEventName.PAYWALL_EXTENSION_QUESTION_ANSWERED, { ...common, ...values });
}

async function advance() {
  if (!canAdvance.value) return;
  trackAnswer();
  if (step.value < 4) {
    step.value += 1;
    return;
  }

  submitting.value = true;
  errorMessage.value = '';
  try {
    const response = await props.submitRequest({
      spaceKey: props.spaceKey,
      macroCount: props.macroCount,
      idempotencyKey,
      answers: answers.value as PaywallExtensionSubmission['answers'],
    });
    result.value = response;
    if (response.status === 'granted') {
      trackUpgradeEvent(UpgradeEventName.PAYWALL_EXTENSION_GRANTED, {
        outcome: response.isReplay ? 'replay' : 'created',
        extension_scope: answers.value.unblockNeed.scope,
        urgency: answers.value.unblockNeed.urgency,
        extension_days: 7,
        is_replay: response.isReplay,
      });
    } else {
      trackUpgradeEvent(UpgradeEventName.PAYWALL_EXTENSION_REPEAT_REQUESTED, {
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
