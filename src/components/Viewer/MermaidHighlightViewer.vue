<template>
  <GenericViewer>
    <template #viewer-actions><button class="highlight-toggle" :aria-pressed="enabled" @click="toggle">◎ 关系高亮 <span class="toggle-dot" :class="{on:enabled}" /></button></template>
    <Mermaid :relationship-highlights="enabled" @highlight-ready="ready = $event" @highlight-used="onUsed" />
    <template #viewer-sidebar><MermaidHighlightFeedback :key="diagramSession" :used="used" :available="enabled && ready" :initial-state="feedbackInitialState" @event="$emit('event',$event)" @state-change="$emit('state-change',$event)" /></template>
  </GenericViewer>
</template>
<script setup>
import { ref, watch } from 'vue'
import store from '@/model/store2'
import GenericViewer from './GenericViewer.vue'
import Mermaid from '@/components/Mermaid.vue'
import MermaidHighlightFeedback from './MermaidHighlightFeedback.vue'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
const props = defineProps({initialState:{type:String,default:'interactive'}})
const emit = defineEmits(['event','state-change','usage-change','enabled-change'])
const enabled = ref(true), ready = ref(false), used = ref(props.initialState !== 'interactive')
const diagramSession = ref(0), feedbackInitialState = ref(props.initialState)
watch(() => [store.state.diagram.id, store.state.diagram.mermaidCode], () => {
  ready.value = false; used.value = false; feedbackInitialState.value = 'interactive'; diagramSession.value++; emit('usage-change',false)
})
function record(name, extra) { const properties={feature_area:'macro',surface:'viewer',macro_type:'mermaid',highlight_feedback_variant:'sidebar',...extra};trackAnalyticsEvent(name,properties);emit('event',{name,properties}) }
function onUsed(target) { if(used.value) return; used.value=true; emit('usage-change',true); record('mermaid_highlight_used',{highlight_target_type:target.kind}) }
function toggle() { enabled.value=!enabled.value;emit('enabled-change',enabled.value);record('mermaid_highlight_preference_changed',{highlight_enabled:enabled.value}) }
</script>
<style scoped>
.highlight-toggle{display:flex;align-items:center;gap:7px;border:0;background:transparent;color:#6e695f;min-height:34px;border-radius:6px;padding:6px 9px;font-size:12px;cursor:pointer}.highlight-toggle:hover{background:#f1eee6}.highlight-toggle:focus-visible{outline:2px solid #2371c5;outline-offset:3px}.toggle-dot{width:23px;height:13px;background:#c9c5bc;border-radius:9px;position:relative}.toggle-dot:after{content:'';position:absolute;width:9px;height:9px;border-radius:50%;background:white;left:2px;top:2px}.toggle-dot.on{background:#807759}.toggle-dot.on:after{left:12px}
</style>
