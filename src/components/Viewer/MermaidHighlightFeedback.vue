<template>
  <!-- Canvas-bottom pill (design "Highlight Feedback Options" → 2a, refining 1b).
       Rendered through GenericViewer's #viewer-canvas-overlay slot, so it floats
       over the diagram's bottom edge without changing the canvas layout. -->
  <div v-if="visible" class="highlight-pill" :class="{ 'highlight-pill--wrap': stage === 'reason' }"
    role="group" aria-label="Relationship highlight feedback"
    @mouseenter="paused = true" @mouseleave="paused = false" @focusin="paused = true" @focusout="paused = false">
    <template v-if="stage === 'question'">
      <span class="label">Relationship highlights helpful?</span>
      <button type="button" @click="choose('like')">Yes</button>
      <button type="button" @click="choose('dislike')">No</button>
    </template>
    <template v-else-if="stage === 'reason'">
      <span class="label">What could be better?</span>
      <button v-for="reason in reasons" :key="reason.id" type="button" @click="chooseReason(reason.id)">{{ reason.label }}</button>
    </template>
    <span v-else class="label" role="status">Thanks for your feedback</span>
    <button v-if="stage !== 'thanks'" type="button" class="close" aria-label="Dismiss relationship highlight feedback" @click="dismiss('close')">×</button>
    <span v-if="stage === 'question'" class="countdown" :style="{ width: `${(left / AUTO_DISMISS_MS) * 100}%` }" aria-hidden="true" />
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

/** The pill waits until the reader has used highlighting this many times on the diagram. */
const SHOW_AFTER_USES = 3
/** Unanswered question stage closes itself after this long; hover/focus pauses the clock. */
const AUTO_DISMISS_MS = 10000
const THANKS_MS = 2500
/** After this many timeouts the pill never returns on this browser. */
const MAX_TIMEOUT_SHOWS = 2
const STORAGE_KEY = 'zenuml.mermaidHighlightFeedback.v1'

const props = defineProps({
  surface: { type: String, default: 'viewer' },
  /** Highlight uses on the current diagram; the parent resets it per diagram. */
  uses: { type: Number, default: 0 },
  available: Boolean,
  /** Export capture in progress: the pill must not be cloned into the image. */
  captureMode: Boolean,
  initialState: { type: String, default: 'interactive' },
})
const emit = defineEmits(['event', 'state-change'])

function readMemory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {} } catch { return {} }
}
function writeMemory(patch) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readMemory(), ...patch })) } catch { /* storage unavailable */ }
}
// Read once per mount; the parent re-keys this component per diagram.
const memory = readMemory()
const retired = memory.closed || (memory.timeouts || 0) >= MAX_TIMEOUT_SHOWS

const initialStages = { prompt: 'question', liked: 'thanks', disliked: 'reason', dismissed: 'dismissed' }
const stage = ref(initialStages[props.initialState] || (retired ? 'dismissed' : 'waiting'))
const left = ref(AUTO_DISMISS_MS)
const paused = ref(false)
const visible = computed(() => props.available && !props.captureMode && ['question', 'reason', 'thanks'].includes(stage.value))
const reasons = [
  { id: 'unclear', label: 'Unclear' },
  { id: 'distracting', label: 'Distracting' },
  { id: 'not_useful', label: 'Not useful' },
  { id: 'other', label: 'Other' },
]
let shown = false
let tick = null
let thanksTimer = null

function record(name, extra = {}) {
  const properties = {
    feature_area: 'macro', surface: props.surface, macro_type: 'mermaid',
    highlight_feedback_variant: 'canvas_pill', ...extra,
  }
  trackAnalyticsEvent(name, properties)
  emit('event', { name, properties })
}

watch(() => props.uses, uses => {
  if (uses >= SHOW_AFTER_USES && stage.value === 'waiting') stage.value = 'question'
}, { immediate: true })
watch(visible, value => {
  if (value && stage.value === 'question' && !shown) {
    shown = true
    record('mermaid_highlight_feedback_shown', { highlight_use_count: props.uses })
  }
}, { immediate: true })
watch(stage, value => {
  emit('state-change', value)
  clearInterval(tick)
  if (value === 'question') {
    left.value = AUTO_DISMISS_MS
    tick = setInterval(() => {
      // The clock only runs while the reader can see the pill and is not on it.
      if (paused.value || !visible.value) return
      left.value -= 100
      if (left.value <= 0) dismiss('timeout')
    }, 100)
  }
  if (value === 'thanks') {
    clearTimeout(thanksTimer)
    thanksTimer = setTimeout(() => { stage.value = 'dismissed' }, THANKS_MS)
  }
}, { immediate: true })
onBeforeUnmount(() => { clearInterval(tick); clearTimeout(thanksTimer) })

function choose(answer) {
  record('mermaid_highlight_feedback_answered', { highlight_feedback: answer })
  writeMemory({ closed: true })
  stage.value = answer === 'like' ? 'thanks' : 'reason'
}
function chooseReason(reason) {
  record('mermaid_highlight_feedback_reason_selected', {
    highlight_feedback: 'dislike', highlight_feedback_reason: reason,
  })
  stage.value = 'thanks'
}
function dismiss(cause) {
  if (['question', 'reason'].includes(stage.value)) {
    record('mermaid_highlight_feedback_dismissed', { highlight_dismiss_stage: stage.value, highlight_dismiss_cause: cause })
    if (cause === 'timeout') writeMemory({ timeouts: (readMemory().timeouts || 0) + 1 })
    else writeMemory({ closed: true })
  }
  stage.value = 'dismissed'
}
</script>
<style scoped>
/* Anchored to GenericViewer's zero-height .viewer-canvas-overlay, whose top
   edge is the diagram's bottom edge: bottom:16px floats the pill 16px above
   the diagram's lower edge, over the diagram and above the footer row. */
.highlight-pill {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 2px;
  max-width: calc(100% - 32px);
  box-sizing: border-box;
  overflow: hidden;
  padding: 4px 4px 4px 14px;
  background: var(--magic-surface, #FFFFFF);
  border: 1px solid var(--magic-border, #E5E7EB);
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, .08);
  color: var(--magic-text-soft, #4B5563);
  font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  white-space: nowrap;
}
.label { padding-right: 4px; }
button {
  font: inherit;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--magic-text, #374151);
  padding: 6px 10px;
  cursor: pointer;
}
button:hover { background: var(--magic-hover, #F3F4F6); }
button:focus-visible { outline: 2px solid var(--magic-primary, #2563EB); outline-offset: 1px; }
.close { color: #6B7280; font-size: 15px; padding: 4px 9px; }
.countdown {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: var(--magic-border-strong, #D1D5DB);
}
/* Narrow canvas: the four reasons no longer fit on one line, so the pill
   becomes a rounded card with the question on its own row. */
@container viewer-canvas (max-width: 480px) {
  .highlight-pill--wrap {
    flex-wrap: wrap;
    white-space: normal;
    border-radius: 14px;
    padding: 8px 8px 8px 14px;
  }
  /* First row: the question with × at its end; the reasons wrap below. */
  .highlight-pill--wrap .label { flex: 1 0 calc(100% - 40px); order: -2; }
  .highlight-pill--wrap .close { order: -1; }
}
</style>
