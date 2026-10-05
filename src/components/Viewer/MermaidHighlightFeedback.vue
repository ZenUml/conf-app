<template>
  <aside v-if="visible" class="highlight-sidecard" aria-label="Relationship highlight feedback">
    <span class="eyebrow">Relationship highlights</span>
    <button class="close" aria-label="Close relationship highlight feedback" @click="dismiss">×</button>
    <div v-if="stage === 'thanks'" role="status">
      <h2>✓ Thanks for your feedback!</h2>
      <p>Your feedback helps us improve diagram viewing.</p>
    </div>
    <div v-else-if="stage === 'reason'">
      <h2>What could be better?</h2>
      <p>Optional: choose the reason that fits best.</p>
      <div class="reasons">
        <button v-for="reason in reasons" :key="reason.id" @click="chooseReason(reason.id)">{{ reason.label }}</button>
      </div>
      <button class="skip" @click="dismiss">Skip</button>
    </div>
    <div v-else>
      <h2>Do you like relationship highlights?</h2>
      <p>Tell us about your experience.</p>
      <div class="answers">
        <button @click="choose('like')">👍 Like</button>
        <button @click="choose('dislike')">👎 Dislike</button>
      </div>
    </div>
  </aside>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
const props = defineProps({
  surface: { type: String, default: 'viewer' },
  used: Boolean,
  available: Boolean,
  initialState: { type: String, default: 'interactive' },
})
const emit = defineEmits(['event', 'state-change'])
const initialStages = { prompt: 'question', liked: 'thanks', disliked: 'reason', dismissed: 'dismissed' }
const stage = ref(initialStages[props.initialState] || 'waiting')
const visible = computed(() => props.used && props.available && ['question', 'reason', 'thanks'].includes(stage.value))
const reasons = [
  { id: 'unclear', label: 'Unclear highlights' },
  { id: 'distracting', label: 'Distracting' },
  { id: 'not_useful', label: 'Not useful' },
  { id: 'other', label: 'Other' },
]
let shown = false

function record(name, extra = {}) {
  const properties = {
    feature_area: 'macro', surface: props.surface, macro_type: 'mermaid',
    highlight_feedback_variant: 'sidebar', ...extra,
  }
  trackAnalyticsEvent(name, properties)
  emit('event', { name, properties })
}

watch(() => props.used, used => {
  if (used && stage.value === 'waiting') stage.value = 'question'
}, { immediate: true })
watch(visible, value => {
  if (value && stage.value === 'question' && !shown) {
    shown = true
    record('mermaid_highlight_feedback_shown')
  }
}, { immediate: true })
watch(stage, value => emit('state-change', value), { immediate: true })

function choose(answer) {
  record('mermaid_highlight_feedback_answered', { highlight_feedback: answer })
  stage.value = answer === 'like' ? 'thanks' : 'reason'
}
function chooseReason(reason) {
  record('mermaid_highlight_feedback_reason_selected', {
    highlight_feedback: 'dislike', highlight_feedback_reason: reason,
  })
  stage.value = 'thanks'
}
function dismiss() {
  if (['question', 'reason'].includes(stage.value)) {
    record('mermaid_highlight_feedback_dismissed', { highlight_dismiss_stage: stage.value })
  }
  stage.value = 'dismissed'
}
</script>
<style scoped>
.highlight-sidecard {
  position: relative;
  box-sizing: border-box;
  flex: 0 0 260px;
  width: 260px;
  padding: 28px 22px;
  background: #f7f4ec;
  border-left: 1px solid #e6dfd1;
  color: #514b3f;
  font: 14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}
.eyebrow {
  display: block;
  font-size: 10px;
  color: #9c917a;
  letter-spacing: .08em;
  margin-bottom: 17px;
}
h2 {
  font-size: 16px;
  line-height: 1.5;
  margin: 0;
  font-weight: 600;
}
p {
  font-size: 12px;
  line-height: 1.7;
  color: #918775;
  margin: 8px 0 0;
}
button {
  font: inherit;
  cursor: pointer;
}
.close {
  position: absolute;
  right: 10px;
  top: 16px;
  background: transparent;
  border: 0;
  color: #938b7d;
  font-size: 20px;
  width: 28px;
  height: 28px;
}
.answers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 17px;
}
.answers button,.reasons button {
  border: 1px solid #dcd6c8;
  border-radius: 6px;
  background: #fffefa;
  padding: 9px 6px;
  color: #514b3f;
  font-size: 12px;
  min-height: 36px;
}
.answers button:hover,.reasons button:hover {
  background: #f2eee4;
  border-color: #aea48b;
}
button:focus-visible {
  outline: 2px solid #2371c5;
  outline-offset: 3px;
}
.reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.reasons button {
  padding: 6px 10px;
}
.skip {
  border: 0;
  background: transparent;
  color: #918775;
  font-size: 12px;
  margin-top: 10px;
  padding: 5px 0;
}

</style>
