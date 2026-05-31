<template>
  <div v-if="phase !== 'hidden'" class="pb-bar">
    <!-- Dismissed state -->
    <template v-if="phase === 'dismissed'">
      <span class="pb-inline">
        <svg class="pb-check" viewBox="0 0 24 24" fill="none" stroke="#22A06B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M20 6 9 17l-5-5" /></svg>
        We'll check back in a few months.
        <button class="pb-link" @click="undo">Undo</button>
      </span>
      <span class="pb-spacer" />
    </template>

    <!-- Thanks state -->
    <template v-else-if="phase === 'thanks'">
      <span class="pb-inline">
        <svg class="pb-check" viewBox="0 0 24 24" fill="none" stroke="#22A06B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M20 6 9 17l-5-5" /></svg>
        <strong>Thanks!</strong>&nbsp;This helps us improve ZenUML.
      </span>
      <span class="pb-spacer" />
    </template>

    <!-- Rate / feedback state -->
    <template v-else>
      <span class="pb-label">How's ZenUML working for you?</span>

      <div class="pb-faces" role="radiogroup" aria-label="Rate your experience" @mouseleave="hovered = null">
        <button
          v-for="(_, i) in 5"
          :key="i"
          class="pb-face-btn"
          :class="{ 'pb-face-selected': score === i, 'pb-face-dim': score !== null && score !== i }"
          role="radio"
          :aria-checked="score === i"
          :aria-label="`${i + 1} of 5 — ${LABELS[i]}`"
          :title="LABELS[i]"
          @mouseenter="hovered = i"
          @click="selectScore(i)"
        >
          <svg class="pb-face-svg" viewBox="0 0 24 24" fill="none"
               :stroke="(hovered === i || score === i) ? '#0C66E4' : '#626F86'"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
               width="22" height="22">
            <circle cx="12" cy="12" r="9" />
            <path d="M9 9.7 v1.1" />
            <path d="M15 9.7 v1.1" />
            <path :d="MOUTHS[i]" />
          </svg>
        </button>
      </div>

      <!-- Inline comment + send, animated in on rating -->
      <div v-if="phase === 'feedback'" class="pb-feedback-row">
        <input
          v-model="feedbackText"
          class="pb-input"
          placeholder="Add a comment (optional)"
          autofocus
          @keydown.enter="submit"
        />
        <button class="pb-link pb-link-brand" @click="submit">Send</button>
      </div>

      <span class="pb-spacer" />
      <button class="pb-link" @click="dismiss">Dismiss</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { view } from '@forge/bridge';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import useCSATState from '@/hooks/useCSATState';
import { isCsatPendingFresh, clearCsatPending } from '@/utils/csat';

const LABELS = ['Very poor', 'Poor', 'OK', 'Good', 'Great'];
const MOUTHS = [
  'M8.5 16.4 Q12 13.4 15.5 16.4',
  'M8.6 15.7 Q12 14.4 15.4 15.7',
  'M9 15.2 H15',
  'M8.6 14.7 Q12 16.3 15.4 14.7',
  'M8.2 14.3 Q12 17.2 15.8 14.3',
];

type Phase = 'hidden' | 'rate' | 'feedback' | 'thanks' | 'dismissed';

const phase = ref<Phase>('hidden');
const score = ref<number | null>(null);
const hovered = ref<number | null>(null);
const feedbackText = ref('');

const { checkStateOfCSAT, markSuppressed, clearSuppressed } = useCSATState();

let closeTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(async () => {
  // The pageBanner mounts on every Confluence page. Any failure here must end
  // in view.close() — never a stranded empty banner frame.
  try {
    // Cheap local gate first: on the ~99% of page loads with no fresh trigger,
    // close immediately without paying the _getCurrentUser lookup.
    if (!isCsatPendingFresh()) {
      view.close();
      return;
    }

    if (await checkStateOfCSAT()) {
      view.close();
      return;
    }

    clearCsatPending();
    phase.value = 'rate';
    // Impression: the banner is committed to showing. This is the denominator
    // for response/dismiss/abandon rates — the only place reach is observable.
    trackAnalyticsEvent('csat_displayed', { feature_area: 'feedback', surface: 'editor' });
  } catch (e) {
    console.warn('[csat] banner mount failed; closing', e);
    view.close();
  }
});

/** The 1-5 rating the user saw, or undefined if no face was selected. */
function ratingValue(): number | undefined {
  return score.value != null ? score.value + 1 : undefined;
}

onBeforeUnmount(() => {
  if (closeTimer) clearTimeout(closeTimer);
});

function selectScore(val: number) {
  score.value = val;
  phase.value = 'feedback';
}

/**
 * Persist / remove 1-week suppression. Synchronous + best-effort: the account
 * was resolved by checkStateOfCSAT() at mount, so both write immediately —
 * coupled to the user action, not to any close timer, and never blocking close.
 */
function suppress() {
  try {
    markSuppressed();
  } catch (e) {
    console.warn('[csat] suppression update failed', e);
  }
}
function unsuppress() {
  try {
    clearSuppressed();
  } catch (e) {
    console.warn('[csat] suppression clear failed', e);
  }
}

function submit() {
  trackAnalyticsEvent('csat_submitted', {
    feature_area: 'feedback',
    surface: 'editor',
    feedback_score: ratingValue(),
    feedback_text: feedbackText.value || undefined,
  });
  phase.value = 'thanks';
  suppress();
  closeTimer = setTimeout(() => view.close(), 3000);
}

function dismiss() {
  // feedback_score is set if the user rated a face before dismissing, undefined
  // if they dismissed outright — distinguishes "rated but abandoned" from "rejected".
  trackAnalyticsEvent('csat_dismissed', {
    feature_area: 'feedback',
    surface: 'editor',
    feedback_score: ratingValue(),
  });
  phase.value = 'dismissed';
  // Persist suppression at the moment of the dismiss action, so it survives
  // even if the iframe is torn down during the Undo window. Undo reverses it.
  suppress();
  closeTimer = setTimeout(() => view.close(), 2500);
}

function undo() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  unsuppress();
  phase.value = 'rate';
  score.value = null;
  feedbackText.value = '';
}
</script>

<style scoped>
.pb-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  background: #F7F8F9;
  border-bottom: 1px solid #DCDFE4;
  min-height: 46px;
  width: 100%;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
}

.pb-label {
  font-size: 13px;
  font-weight: 500;
  color: #44546F;
  white-space: nowrap;
  flex-shrink: 0;
}

.pb-faces {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.pb-face-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  padding: 0;
  cursor: pointer;
  background: transparent;
  transition: background 0.14s, transform 0.14s cubic-bezier(0.16, 0.84, 0.44, 1);
}

.pb-face-btn:hover {
  background: rgba(9, 30, 66, 0.06);
  transform: translateY(-1px) scale(1.08);
}

.pb-face-selected {
  background: rgba(12, 102, 228, 0.08);
}

.pb-face-dim {
  opacity: 0.5;
}

.pb-face-svg {
  transition: stroke 0.15s;
  flex-shrink: 0;
}

.pb-feedback-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  max-width: 460px;
  animation: pb-fade 0.2s ease both;
}

.pb-input {
  flex: 1;
  height: 32px;
  border: 1px solid #DCDFE4;
  border-radius: 6px;
  padding: 0 10px;
  font-size: 13px;
  color: #172B4D;
  font-family: inherit;
  outline: none;
  background: #fff;
  min-width: 0;
}

.pb-input:focus {
  border-color: #0C66E4;
  box-shadow: 0 0 0 2px rgba(12, 102, 228, 0.13);
}

.pb-spacer {
  flex: 1;
}

.pb-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #44546F;
}

.pb-inline strong {
  color: #172B4D;
}

.pb-check {
  flex-shrink: 0;
}

.pb-link {
  background: transparent;
  color: #44546F;
  border: 0;
  padding: 6px 4px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  flex-shrink: 0;
}

.pb-link:hover {
  color: #172B4D;
  text-decoration: underline;
}

.pb-link-brand {
  color: #0C66E4;
}

.pb-link-brand:hover {
  color: #0055CC;
}

@keyframes pb-fade {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: none; }
}
</style>
