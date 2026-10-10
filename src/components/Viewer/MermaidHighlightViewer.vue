<template>
  <GenericViewer :wide="wide" :hide-header="hideHeader" :relationship-highlights="enabled"
    @capture-mode-change="onCaptureModeChange" @magic-highlight-ready="onReady($event)" @magic-highlight-used="onUsed">
    <!-- Design "Viewer Header Highlight Analysis" option 1e: no header control.
         Highlights are on by default, so discovery is the hover itself plus a
         one-time canvas hint; the switch is the first item of the More menu. -->
    <template v-if="ready || supported" #viewer-more-menu-start="{ close }">
      <button type="button" role="menuitemcheckbox" tabindex="-1" class="overflow-menu-item highlight-switch"
        :aria-checked="enabled ? 'true' : 'false'" title="Highlight relationships" @click="toggle('header_more_menu', close)">
        <span class="overflow-menu-item-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672ZM12 2.25V4.5m5.834.166-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243-1.59-1.59" />
          </svg>
        </span>
        <span class="highlight-switch-label">Relationship highlights</span>
        <svg v-if="enabled" class="highlight-switch-check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </button>
    </template>
    <Mermaid ref="renderer" :relationship-highlights="enabled" @highlight-ready="onReady($event)" @highlight-used="onUsed" />
    <template #viewer-canvas-overlay>
      <div v-if="hintVisible" class="highlight-hint" role="status">
        <span class="highlight-hint-label">Highlighting connections</span>
        <button type="button" class="highlight-hint-off" @click="hintTurnOff">Turn off</button>
        <button type="button" class="highlight-hint-close" aria-label="Dismiss highlight hint" @click="dismissHint('close')">×</button>
      </div>
      <MermaidHighlightFeedback :key="diagramSession" :surface="surface" :uses="useCount" :available="enabled && ready" :capture-mode="captureActive" :initial-state="feedbackInitialState" @event="$emit('event',$event)" @state-change="onFeedbackStage" />
    </template>
  </GenericViewer>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import store from '@/model/store2'
import GenericViewer from './GenericViewer.vue'
import Mermaid from '@/components/Mermaid.vue'
import MermaidHighlightFeedback from './MermaidHighlightFeedback.vue'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

/** "Hint seen" is per device, like the feedback pill's memory: one show per browser. */
const HINT_KEY = 'zenuml.mermaidHighlightHint.v1'
function hintSeen() {
  try { return !!JSON.parse(localStorage.getItem(HINT_KEY))?.seen } catch { return false }
}
function markHintSeen() {
  try { localStorage.setItem(HINT_KEY, JSON.stringify({ seen: true })) } catch { /* storage unavailable */ }
}

const props = defineProps({
  initialState: { type: String, default: 'interactive' },
  wide: { type: Boolean, default: false },
  hideHeader: { type: Boolean, default: false },
})
const emit = defineEmits(['event', 'state-change', 'usage-change', 'enabled-change'])
const renderer = ref(null)
const surface = computed(() => forgeGlobal.forgeContext?.extension?.modal?.macroMode === 'fullscreen' ? 'fullscreen' : 'viewer')
const captureActive = ref(false)
function onCaptureModeChange(active) { captureActive.value = active; renderer.value?.setCaptureMode(active) }
const enabled = ref(true)
const ready = ref(false)
// Highlight uses on the current diagram. The feedback pill waits for the third;
// a non-interactive initialState (Storybook) starts past that threshold.
const useCount = ref(props.initialState !== 'interactive' ? 3 : 0)
const supported = ref(false)
const diagramSession = ref(0)
const feedbackInitialState = ref(props.initialState)
const feedbackStage = ref('waiting')
const feedbackOpen = computed(() => ['question', 'reason', 'thanks'].includes(feedbackStage.value))

// The hint is open from the first use until Turn off or ×. It is hidden, not
// closed, while highlights are off, during an export capture, and while the
// feedback pill is up (both sit at the canvas bottom; the pill is the one
// collecting data), so it comes back when those end.
const hintShown = ref(false)
const hintVisible = computed(() => hintShown.value && enabled.value && ready.value && !captureActive.value && !feedbackOpen.value)
let hintRecorded = false
watch(hintVisible, visible => {
  if (visible && !hintRecorded) { hintRecorded = true; record('mermaid_highlight_hint_shown') }
})

function onReady(value) {
  ready.value = value
  if (value) supported.value = true
}

watch(() => [store.state.diagram.id, store.state.diagram.mermaidCode], () => {
  setEnabled(true)
  ready.value = false
  supported.value = false
  useCount.value = 0
  feedbackInitialState.value = 'interactive'
  diagramSession.value++
  emit('usage-change', false)
})

function record(name, extra) {
  const properties = {
    feature_area: 'macro', surface: surface.value, macro_type: 'mermaid',
    highlight_feedback_variant: 'canvas_pill', ...extra,
  }
  trackAnalyticsEvent(name, properties)
  emit('event', { name, properties })
}

function onUsed(target) {
  if (!enabled.value || !ready.value) return
  useCount.value++
  if (useCount.value === 1) {
    emit('usage-change', true)
    record('mermaid_highlight_used', { highlight_target_type: target.kind })
  }
  if (!hintShown.value && !hintSeen()) { markHintSeen(); hintShown.value = true }
}

function onFeedbackStage(stage) {
  feedbackStage.value = stage
  emit('state-change', stage)
}

/** `where` names the control that flipped the switch; absent for the per-diagram reset. */
function setEnabled(value, where) {
  enabled.value = value
  emit('enabled-change', value)
  if (where) record('mermaid_highlight_preference_changed', { highlight_enabled: value, action_location: where })
}
function toggle(where, close) {
  setEnabled(!enabled.value, where)
  close?.()
}
function dismissHint(cause) {
  if (!hintShown.value) return
  hintShown.value = false
  record('mermaid_highlight_hint_dismissed', { highlight_dismiss_cause: cause })
}
function hintTurnOff() {
  dismissHint('turn_off')
  setEnabled(false, 'canvas_hint')
}
</script>
<style scoped>
.highlight-switch-label { flex: 1; }
.highlight-switch-check {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--magic-primary, #2563EB);
}
/* Anchored to GenericViewer's zero-height .viewer-canvas-overlay like the
   feedback pill, but at the canvas's bottom-left corner. */
.highlight-hint {
  position: absolute;
  left: 14px;
  bottom: 14px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 12px;
  background: var(--magic-surface, #FFFFFF);
  border: 1px solid var(--magic-border, #E5E7EB);
  border-radius: 999px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .08);
  color: var(--magic-text-soft, #4B5563);
  font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  white-space: nowrap;
}
.highlight-hint button {
  font: inherit;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}
.highlight-hint button:hover { background: var(--magic-hover, #F3F4F6); }
.highlight-hint button:focus-visible { outline: 2px solid var(--magic-primary, #2563EB); outline-offset: 1px; }
.highlight-hint-off { padding: 4px 9px; color: var(--magic-primary, #2563EB); }
.highlight-hint-close { width: 24px; height: 24px; padding: 0; font-size: 14px; color: #6B7280; }
</style>
