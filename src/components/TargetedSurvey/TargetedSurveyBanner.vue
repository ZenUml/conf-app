<template>
  <div v-if="phase !== 'hidden'" class="survey-banner" role="region" aria-label="ZenUML feedback survey">
    <template v-if="phase === 'invite'">
      <strong>{{ survey.title }}</strong>
      <span class="spacer" />
      <button type="button" class="primary" @click="openForm">Share feedback</button>
      <button type="button" class="quiet" @click="dismiss">Dismiss</button>
    </template>
    <template v-else-if="phase === 'form'">
      <div class="form">
        <strong>{{ survey.question }}</strong>
        <div class="choices" role="group" :aria-label="survey.question">
          <label v-for="option in survey.options" :key="option">
            <input v-model="selected" type="checkbox" :value="option" :disabled="sending" />
            {{ labels[option] }}
          </label>
        </div>
        <label class="detail-label" for="targeted-survey-detail">What were you trying to do, and what got in your way? <span>(optional)</span></label>
        <textarea id="targeted-survey-detail" v-model="detail" :disabled="sending" maxlength="2000" rows="2" />
        <p class="note">Please do not include confidential content.</p>
        <p v-if="error" class="error" role="alert">Could not send your feedback. Please try again.</p>
      </div>
      <div class="actions">
        <button type="button" class="primary" :disabled="sending || !canSend" @click="send">{{ sending ? 'Sending…' : 'Send feedback' }}</button>
        <button type="button" class="quiet" @click="dismiss">Dismiss</button>
      </div>
    </template>
    <template v-else>
      <strong>Thank you for helping us improve ZenUML.</strong>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { view } from '@forge/bridge';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import type { PublicSurvey } from '@/features/targetedSurvey/survey';
import { claimSurveyBanner, isSurveyTerminal, markSurveyTerminal } from '@/features/targetedSurvey/ownership';
import { createSurveySubmission } from '@/features/targetedSurvey/submission';

const props = defineProps<{
  survey: PublicSurvey;
  terminalKey: string;
  /** Local visual preview with synthetic data; never calls the backend. */
  previewInitialPhase?: 'invite' | 'form';
}>();

type Phase = 'hidden' | 'invite' | 'form' | 'thanks';
const phase = ref<Phase>('hidden');
const selected = ref<string[]>([]);
const detail = ref('');
const error = ref(false);
const sending = ref(false);
const canSend = computed(() => selected.value.length > 0 || detail.value.trim().length > 0);
const labels: Record<string, string> = {
  performance: 'Loading or responsiveness',
  editing: 'Editing diagrams',
  display: 'Display or layout',
  export: 'Exporting or sharing',
  missing_feature: 'A feature I need is missing',
  other: 'Something else',
};
let release: (() => void) | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const submission = createSurveySubmission(props.survey);
const preview = !!props.previewInitialPhase;
const eventProperties = {
  feature_area: 'feedback' as const,
  surface: 'page_banner' as const,
  survey_uuid: props.survey.uuid,
  survey_revision: props.survey.revision,
};

function close() {
  phase.value = 'hidden';
  release?.();
  if (!preview) void view.close();
}

onMounted(() => {
  if (preview) {
    phase.value = props.previewInitialPhase!;
    return;
  }
  if (Date.now() >= Date.parse(props.survey.expiresAt)) {
    close();
    return;
  }
  release = claimSurveyBanner(props.terminalKey, () => {
    if (Date.now() >= Date.parse(props.survey.expiresAt)) { close(); return; }
    phase.value = 'invite';
    trackAnalyticsEvent('targeted_survey_shown', eventProperties);
  }, close);
});

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  release?.();
});

function openForm() {
  if (phase.value !== 'invite') return;
  phase.value = 'form';
  void nextTick(() => document.querySelector<HTMLInputElement>('.survey-banner input[type="checkbox"]')?.focus());
  if (!preview) trackAnalyticsEvent('targeted_survey_opened', eventProperties);
}

function dismiss() {
  if (phase.value === 'hidden' || phase.value === 'thanks') return;
  if (!preview) {
    markSurveyTerminal(props.terminalKey, 'dismissed');
    trackAnalyticsEvent('targeted_survey_dismissed', eventProperties);
  }
  close();
}

async function send() {
  if (phase.value !== 'form' || sending.value || !canSend.value) return;
  if (preview) { phase.value = 'thanks'; return; }
  if (Date.now() >= Date.parse(props.survey.expiresAt) || isSurveyTerminal(props.terminalKey)) { close(); return; }
  sending.value = true;
  error.value = false;
  try {
    await submission.send(selected.value, detail.value);
    // Dismissal may happen while a request is in flight. Never resurrect it.
    if (phase.value !== 'form' || isSurveyTerminal(props.terminalKey)) return;
    if (!markSurveyTerminal(props.terminalKey, 'submitted')) { close(); return; }
    trackAnalyticsEvent('targeted_survey_submitted', eventProperties);
    phase.value = 'thanks';
    release?.();
    timer = setTimeout(close, 2500);
  } catch {
    if (phase.value === 'form' && !isSurveyTerminal(props.terminalKey)) {
      error.value = true;
      trackAnalyticsEvent('targeted_survey_submit_failed', eventProperties);
    }
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.survey-banner { display: flex; align-items: center; gap: 14px; padding: 10px 20px; width: 100%; box-sizing: border-box; background: #f7f8f9; border-bottom: 1px solid #dcdfe4; color: #172b4d; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.spacer { flex: 1; }
.form { flex: 1; max-width: 740px; }
.form strong { display: block; margin-bottom: 8px; }
.choices { display: flex; flex-wrap: wrap; gap: 8px 15px; margin-bottom: 10px; }
.choices label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.choices input { accent-color: #0c66e4; }
.detail-label { display: block; margin-bottom: 4px; }
.detail-label span, .note { color: #626f86; }
textarea { display: block; box-sizing: border-box; width: 100%; max-width: 620px; padding: 6px 8px; border: 1px solid #8590a2; border-radius: 4px; font: inherit; resize: vertical; }
textarea:focus, button:focus-visible, input:focus-visible { outline: 2px solid #0c66e4; outline-offset: 2px; }
.note { margin: 5px 0 0; font-size: 12px; }
.error { color: #ae2a19; margin: 5px 0 0; }
.actions { align-self: flex-end; display: flex; align-items: center; gap: 7px; padding-bottom: 1px; }
button { border: 0; border-radius: 4px; padding: 7px 10px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
button:disabled { opacity: .6; cursor: default; }
.primary { background: #0c66e4; color: #fff; }
.quiet { background: transparent; color: #44546f; }
.quiet:hover { background: #e9edf2; }
@media (max-width: 640px) { .survey-banner { flex-wrap: wrap; } .actions { width: 100%; } }
</style>
