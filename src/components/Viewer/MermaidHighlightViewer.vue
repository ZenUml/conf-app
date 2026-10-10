<template>
  <GenericViewer :wide="wide" :hide-header="hideHeader" :relationship-highlights="enabled"
    @capture-mode-change="onCaptureModeChange" @magic-highlight-ready="onReady($event)" @magic-highlight-used="onUsed">
    <template #viewer-actions>
      <button v-if="ready || supported" class="highlight-toggle" aria-label="Relationship highlights" title="Highlight connected nodes and lines on hover or selection" :aria-pressed="enabled" @click="toggle"><span aria-hidden="true">◎</span><span class="highlight-label">Highlight</span><span class="toggle-dot" :class="{on:enabled}" /></button>
    </template>
    <Mermaid ref="renderer" :relationship-highlights="enabled" @highlight-ready="onReady($event)" @highlight-used="onUsed" />
    <template #viewer-canvas-overlay>
      <MermaidHighlightFeedback :key="diagramSession" :surface="surface" :uses="useCount" :available="enabled && ready" :capture-mode="captureActive" :initial-state="feedbackInitialState" @event="$emit('event',$event)" @state-change="$emit('state-change',$event)" />
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

function onReady(value) {
  ready.value = value
  if (value) supported.value = true
}

watch(() => [store.state.diagram.id, store.state.diagram.mermaidCode], () => {
  enabled.value = true
  emit('enabled-change', true)
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
  if (useCount.value !== 1) return
  emit('usage-change', true)
  record('mermaid_highlight_used', { highlight_target_type: target.kind })
}

function toggle() {
  enabled.value = !enabled.value
  emit('enabled-change', enabled.value)
  record('mermaid_highlight_preference_changed', { highlight_enabled: enabled.value })
}
</script>
<style scoped>
.highlight-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: transparent;
  color: #6e695f;
  min-height: 34px;
  border-radius: 6px;
  padding: 6px 9px;
  font-size: 12px;
  cursor: pointer;
}
.highlight-toggle:hover {
  background: #f1eee6;
}
.highlight-toggle:focus-visible {
  outline: 2px solid #2371c5;
  outline-offset: 3px;
}
:global(.viewer-edge-top:has(.highlight-toggle)) {
  container: mermaid-highlight-header viewer-header / inline-size;
}
@container mermaid-highlight-header (max-width: 600px) {
  .highlight-label { display: none; }
}
.toggle-dot {
  width: 23px;
  height: 13px;
  background: #c9c5bc;
  border-radius: 9px;
  position: relative;
}
.toggle-dot:after {
  content: '';
  position: absolute;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: white;
  left: 2px;
  top: 2px;
}
.toggle-dot.on {
  background: #807759;
}
.toggle-dot.on:after {
  left: 12px;
}

</style>
