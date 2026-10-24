<template>
  <div class="prototype-page" lang="zh-CN">
    <p class="review-label">Real viewer components · 关系高亮反馈</p>
    <MermaidHighlightViewer :key="session" :initial-state="activeInitialState" @event="record" @state-change="stage = $event" @usage-change="used = $event" @enabled-change="enabled = $event" />
    <div class="prototype-tray" aria-label="Prototype review controls"><div class="tray-top"><strong>PROTOTYPE · 画布底部胶囊</strong><button @click="restart">重新体验 ↻</button></div><div>used: {{ used }} · stage: {{ stage }} · enabled: {{ enabled }} · 仅本地 · 不发送数据</div><div class="events">{{ events.length ? events.map(e => e.name.replace('mermaid_highlight_', '')).join(' → ') : '在图上悬停 700ms 或选择节点' }}</div></div>
  </div>
</template>
<script setup>
import { ref } from 'vue'
import MermaidHighlightViewer from './MermaidHighlightViewer.vue'
const props = defineProps({initialState:{type:String,default:'interactive'}})
const session=ref(0),activeInitialState=ref(props.initialState),stage=ref('waiting'),used=ref(props.initialState!=='interactive'),enabled=ref(true),events=ref([])
function record(event){events.value=[...events.value.slice(-5),event]}
function restart(){events.value=[];used.value=false;enabled.value=true;activeInitialState.value='interactive';session.value++}
</script>
<style scoped>
.prototype-page{box-sizing:border-box;min-width:900px;min-height:100vh;padding:24px 24px 150px;background:#f7f6f2;color:#38362f;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.review-label{margin:0 0 18px;color:#8b8579;font-size:12px}.prototype-tray{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);width:min(920px,calc(100vw - 50px));box-sizing:border-box;background:#262c34;color:#b1bac8;border:1px solid #434a55;border-radius:12px;padding:12px 17px;z-index:20;font:11px ui-monospace,SFMono-Regular,monospace;line-height:1.8}.tray-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.tray-top strong{font-size:10px;color:#acb6c5}.tray-top button{background:transparent;border:1px solid #4a5361;color:#dbe1e9;border-radius:5px;padding:6px 9px;cursor:pointer}.events{color:#8494aa;font-size:10px}.prototype-page :deep(.viewer-frame--fullscreen){min-height:620px;height:calc(100vh - 230px)}
</style>
