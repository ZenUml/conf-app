<template>
  <div class="prototype-page" lang="zh-CN">
    <p class="review-label">Viewer design exploration <span>· 关系高亮反馈</span></p>
    <section class="viewer-shell" aria-label="Mermaid diagram viewer">
      <header class="viewer-header">
        <div class="title-group"><h1>订单处理流程</h1><span class="type-chip">Mermaid</span></div>
        <div class="viewer-actions" role="toolbar" aria-label="图表操作">
          <button :aria-pressed="enabled" @click="toggleEnabled" class="highlight-toggle"><span aria-hidden="true">◎</span> 关系高亮 <span class="toggle-dot" :class="{ on: enabled }" /></button>
          <div v-if="variant === 'toolbar' && eligible" class="feedback-anchor">
            <button class="quiet-action" :aria-expanded="popoverOpen" aria-controls="highlight-feedback" @click="togglePopover">反馈 <span aria-hidden="true">♡</span></button>
          </div>
          <span class="action-divider" /><button class="quiet-action" aria-label="适应窗口" @click="fitDiagram">⤢</button><button class="quiet-action" aria-label="查看源代码" @click="sourceOpen = !sourceOpen">&lt;/&gt;</button><button class="quiet-action" aria-label="更多操作" @click="menuOpen = !menuOpen">•••</button>
        </div>
      </header>
      <div class="viewer-body" :class="{ 'with-sidebar': variant === 'sidebar' }">
        <div class="canvas-column">
          <div class="diagram-canvas" ref="canvas" @pointerover="hoverStart" @pointerout="hoverEnd" @click="interactionUsed" @focusin="interactionUsed">
            <div ref="diagramHost" class="diagram-host" aria-label="订单处理流程图" />
            <p v-if="renderError" class="render-error" role="alert">图表暂时无法显示</p>
            <div v-if="sourceOpen" class="source-panel"><button class="close" aria-label="关闭源代码" @click="sourceOpen=false">×</button><pre>{{ source }}</pre></div>
            <div v-if="menuOpen" class="example-menu"><button @click="fitDiagram(); menuOpen=false">适应窗口</button></div>
            <span class="canvas-hint">{{ enabled ? '悬停查看关系 · 点击保持高亮 · Esc 清除' : '关系高亮已关闭' }}</span>
          </div>
          <div class="reserved-footer">
            <div v-if="variant === 'footer' && eligible" class="feedback-panel footer-feedback" id="highlight-feedback"><FeedbackContent /></div>
            <div v-else class="attribution"><span>◈ ZenUML</span><span>订单与履约</span></div>
          </div>
        </div>
        <aside v-if="variant === 'sidebar'" class="sidecard-space" aria-label="关系高亮反馈">
          <div v-if="eligible" class="feedback-panel sidecard" id="highlight-feedback"><span class="sidecard-eyebrow">关系高亮</span><FeedbackContent /></div>
          <div v-else class="sidecard-placeholder"><span aria-hidden="true">◎</span><h2>看清每一步的联系</h2><p>在图上悬停或选择一个节点，查看它的关联路径。</p></div>
        </aside>
      </div>
      <div v-if="variant === 'toolbar' && eligible && popoverOpen" class="feedback-panel toolbar-popover" id="highlight-feedback"><FeedbackContent /></div>
    </section>
    <div class="prototype-tray" aria-label="Prototype review controls">
      <div class="tray-top"><strong>PROTOTYPE</strong><button aria-label="Previous variant" @click="cycleVariant(-1)">←</button><div class="variant-options"><button v-for="item in variants" :key="item.id" :aria-pressed="variant === item.id" @click="setVariant(item.id)">{{ item.label }}</button></div><button aria-label="Next variant" @click="cycleVariant(1)">→</button><button class="restart" @click="restart">重新体验 ↻</button></div>
      <div class="state-row">used: {{ used }} · stage: {{ stage }} · answer: {{ answer || 'none' }} · enabled: {{ enabled }} <span>仅本地 · 不发送数据</span></div>
      <div class="event-row">{{ events.length ? events.map(e => e.name.replace('mermaid_highlight_', '')).join(' → ') : '尚无交互事件 · 在图上悬停 700ms 或选择节点' }}</div>
    </div>
  </div>
</template>

<script>
// Shared queue keeps database snapshots and renders together across Storybook remounts.
let prototypeRenderQueue = Promise.resolve()
</script>

<script setup>
// Throwaway Storybook prototype: compare footer, toolbar popover and adjacent sidecard
// at one route via ?variant=. No production viewer integration or persistence.
import { ref, computed, onMounted, onBeforeUnmount, watch, h, defineComponent } from 'vue'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { attachMermaidHighlights, readMermaidFlowchartModel } from '../../../tools/mermaid-highlights/src/mermaid-highlights.mjs'
const props = defineProps({ initialState: { type: String, default: 'interactive' } })
const source = `flowchart LR
  A[购物车] --> B[创建订单]
  B --> C[库存检查]
  B --> D[支付处理]
  B --> E[订单记录]
  C --> F[订单事件]
  C --> G[仓库备货]
  D --> F
  D --> G
  E --> F
  E --> H[通知客户]
  classDef default fill:#fbf8f2,stroke:#bcb3a5,color:#3d3933,stroke-width:1.4px;`
const variants = [{id:'footer',label:'底部内联 · 推荐'},{id:'toolbar',label:'工具栏弹出'},{id:'sidebar',label:'旁侧反馈卡'}]
const initialVariant = new URLSearchParams(window.location.search).get('variant')
const variant = ref(variants.some(v=>v.id===initialVariant) ? initialVariant : 'footer')
const used=ref(false), stage=ref('waiting'), answer=ref(null), enabled=ref(true), popoverOpen=ref(false), events=ref([])
const diagramHost=ref(null), canvas=ref(null), renderError=ref(false), sourceOpen=ref(false), menuOpen=ref(false)
const eligible=computed(()=>stage.value==='question'||stage.value==='reason'||stage.value==='thanks')
let controller=null, model=null, hoverTimer=null, hoverItem=null, alive=true
function record(name, extra={}) {
  const properties={feature_area:'macro',surface:'viewer',macro_type:'mermaid',highlight_feedback_variant:variant.value,...extra}
  // Storybook aliases this import to its noop; the visible log is memory-only.
  trackAnalyticsEvent(name, properties)
  events.value=[...events.value.slice(-5),{name,properties}]
}
function visiblePrompt() { if(stage.value==='question') record('mermaid_highlight_feedback_shown') }
function markUsed(target) {
  if(!enabled.value||used.value||!target)return
  used.value=true;stage.value='question'
  record('mermaid_highlight_used',{highlight_target_type:target.kind})
  if(variant.value!=='toolbar') visiblePrompt()
}
function targetFrom(event) {
  const el=event.target.closest?.('[data-hit-node], [data-hit-edge], g[data-node], path[data-edge]')
  if(!el||!diagramHost.value?.contains(el))return null
  return {el,kind:el.hasAttribute('data-hit-node')||el.hasAttribute('data-node')?'node':'edge'}
}
function clearHover(){clearTimeout(hoverTimer);hoverTimer=null;hoverItem=null}
function hoverStart(event) {
  const target=targetFrom(event);if(!target||!enabled.value||used.value||hoverItem===target.el)return
  clearHover();hoverItem=target.el;hoverTimer=setTimeout(()=>{markUsed(target);clearHover()},700)
}
function hoverEnd(event) {
  if(hoverItem&&event.target===hoverItem&&!hoverItem.contains(event.relatedTarget))clearHover()
}
function interactionUsed(event){const target=targetFrom(event);if(target)markUsed(target)}
function choose(value) {
  answer.value=value;record('mermaid_highlight_feedback_answered',{highlight_feedback:value})
  stage.value=value==='like'?'thanks':'reason'
}
function reason(value) { record('mermaid_highlight_feedback_reason_selected',{highlight_feedback:'dislike',highlight_feedback_reason:value});stage.value='thanks' }
function dismiss() { if(stage.value==='question'||stage.value==='reason')record('mermaid_highlight_feedback_dismissed',{highlight_dismiss_stage:stage.value});stage.value='dismissed';popoverOpen.value=false }
function togglePopover(){popoverOpen.value=!popoverOpen.value;if(popoverOpen.value)visiblePrompt()}
function attach(){const svg=diagramHost.value?.querySelector('svg');if(svg&&model&&enabled.value)controller=attachMermaidHighlights(svg,model)}
function toggleEnabled(){enabled.value=!enabled.value;clearHover();if(enabled.value)attach();else{controller?.destroy();controller=null}record('mermaid_highlight_preference_changed',{highlight_enabled:enabled.value})}
function setVariant(value){variant.value=value;const url=new URL(window.location.href);url.searchParams.set('variant',value);window.history.replaceState({},'',url);popoverOpen.value=false;if(used.value&&stage.value==='question'&&value!=='toolbar')visiblePrompt()}
function cycleVariant(delta){const index=variants.findIndex(v=>v.id===variant.value);setVariant(variants[(index+delta+variants.length)%variants.length].id)}
function initializeState(){used.value=props.initialState!=='interactive';answer.value=props.initialState==='liked'?'like':props.initialState==='disliked'?'dislike':null;stage.value={interactive:'waiting',prompt:'question',liked:'thanks',disliked:'reason',dismissed:'dismissed'}[props.initialState]||'waiting';popoverOpen.value=used.value&&variant.value==='toolbar'&&stage.value!=='dismissed';events.value=[]}
function restart(){clearHover();controller?.reset();enabled.value=true;controller?.destroy();controller=null;attach();used.value=false;stage.value='waiting';answer.value=null;popoverOpen.value=false;events.value=[]}
function fitDiagram(){const svg=diagramHost.value?.querySelector('svg');if(svg){svg.style.width='100%';svg.style.maxWidth='100%';svg.style.height='auto'}}
function onKey(event){if(event.target.closest?.('input,textarea,[contenteditable],svg'))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();cycleVariant(event.key==='ArrowLeft'?-1:1)}}
const FeedbackContent=defineComponent({setup(){return()=>h('div',{class:['feedback-content',stage.value]},[
  h('button',{class:'close','aria-label':'关闭关系高亮反馈',onClick:dismiss},'×'),
  stage.value==='thanks'?h('div',{class:'thankyou',role:'status'},[h('span',{class:'thanks-check','aria-hidden':'true'},'✓'),h('strong',{},'谢谢你的反馈！'),h('p',{},'你的意见会帮助我们改进图表体验。')]):
  stage.value==='reason'?h('div',{},[h('h2',{},'哪里可以改进？'),h('p',{class:'reason-hint'},'可选，选择最符合你感受的一项。'),h('div',{class:'reason-options'},[['unclear','高亮不够清楚'],['distracting','操作有干扰'],['not_useful','对我没帮助'],['other','其他']].map(([id,label])=>h('button',{onClick:()=>reason(id)},label))),h('button',{class:'skip',onClick:dismiss},'跳过')]):
  h('div',{class:'question-content'},[h('div',{class:'question-copy'},[h('h2',{},'你喜欢这个关系高亮功能吗？'),h('p',{},'告诉我们这次查看图表的感受。')]),h('div',{class:'answer-options'},[h('button',{'aria-pressed':answer.value==='like',onClick:()=>choose('like')},'👍 喜欢'),h('button',{'aria-pressed':answer.value==='dislike',onClick:()=>choose('dislike')},'👎 不喜欢')])])
])}})
initializeState()
watch(()=>props.initialState,initializeState)
onMounted(async()=>{
  window.addEventListener('keydown',onKey)
  const renderTask=prototypeRenderQueue.then(async()=>{
    if(!alive)return
    const {default:mermaid}=await import('mermaid')
    // Keep database snapshot and render serialized across prototype instances.
    mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',themeVariables:{fontFamily:'Arial, sans-serif',fontSize:'15px',lineColor:'#a79e90',primaryColor:'#fbf8f2',primaryTextColor:'#3d3933',primaryBorderColor:'#bcb3a5'},flowchart:{curve:'basis',nodeSpacing:34,rankSpacing:30}})
    const diagram=await mermaid.mermaidAPI.getDiagramFromText(source);model=readMermaidFlowchartModel(diagram)
    const rendered=await mermaid.render('feedback-prototype-'+Math.random().toString(36).slice(2),source)
    if(!alive)return
    diagramHost.value.innerHTML=rendered.svg;rendered.bindFunctions?.(diagramHost.value);await document.fonts.ready;fitDiagram();attach()
  })
  prototypeRenderQueue=renderTask.catch(()=>{})
  try{await renderTask}catch(error){if(alive)renderError.value=true;console.error('Mermaid feedback prototype render',error)}
})
onBeforeUnmount(()=>{alive=false;clearHover();controller?.destroy();window.removeEventListener('keydown',onKey)})
</script>

<style scoped>
.prototype-page{box-sizing:border-box;min-width:720px;min-height:100vh;padding:30px 24px 180px;background:#f7f6f2;color:#38362f;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.review-label{max-width:1160px;margin:0 auto 18px;color:#8b8579;font-size:12px;letter-spacing:.03em}.review-label span{color:#a39b8e}.viewer-shell{position:relative;max-width:1160px;margin:auto;border:1px solid #dedbd3;border-radius:12px;background:#fffefa;box-shadow:0 5px 22px #423a2810;overflow:visible}.viewer-header{height:70px;display:flex;align-items:center;justify-content:space-between;padding:0 25px;border-bottom:1px solid #e9e5db}.title-group{display:flex;align-items:center;gap:12px}h1{font-size:17px;font-weight:600;margin:0}.type-chip{border:1px solid #e6e1d5;border-radius:5px;padding:4px 7px;color:#817966;background:#f7f4eb;font-size:11px}.viewer-actions{display:flex;align-items:center;gap:7px}button{font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #2371c5;outline-offset:3px}.quiet-action,.highlight-toggle{border:0;background:transparent;color:#6e695f;min-height:34px;border-radius:6px;padding:6px 9px}.quiet-action:hover,.highlight-toggle:hover{background:#f1eee6}.highlight-toggle{display:flex;align-items:center;gap:7px;font-size:12px}.toggle-dot{width:23px;height:13px;background:#c9c5bc;border-radius:9px;position:relative}.toggle-dot:after{content:'';position:absolute;width:9px;height:9px;border-radius:50%;background:white;left:2px;top:2px}.toggle-dot.on{background:#807759}.toggle-dot.on:after{left:12px}.action-divider{height:20px;border-left:1px solid #e5e0d6;margin:0 5px}.viewer-body{display:flex}.canvas-column{flex:1;min-width:0}.diagram-canvas{position:relative;box-sizing:border-box;height:420px;padding:36px 30px 50px;display:flex;align-items:center;justify-content:center;background:#fffefa;border-radius:0 0 12px 12px;overflow:hidden}.diagram-host{width:100%;max-width:1040px}.diagram-host :deep(svg){display:block;margin:auto;max-height:340px}.canvas-hint{position:absolute;bottom:18px;left:0;right:0;text-align:center;font-size:11px;color:#989184}.reserved-footer{height:120px;box-sizing:border-box;padding:17px 25px;border-top:1px solid #ece8de}.attribution{display:flex;justify-content:space-between;font-size:11px;color:#aaa18f;padding-top:9px}.feedback-panel{position:relative}.feedback-panel :deep(.feedback-content){position:relative;padding-right:22px}.feedback-panel :deep(h2){margin:0;font-size:14px;font-weight:600;line-height:1.5}.feedback-panel :deep(p){margin:5px 0 0;color:#989082;font-size:12px;line-height:1.5}.feedback-panel :deep(.question-content){display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:61px}.feedback-panel :deep(.answer-options){display:flex;gap:8px;flex-shrink:0}.feedback-panel :deep(.answer-options button),.feedback-panel :deep(.reason-options button){border:1px solid #dcd6c8;border-radius:6px;background:#fffefa;padding:9px 14px;color:#514b3f;font-size:12px;min-height:36px}.feedback-panel :deep(.answer-options button:hover),.feedback-panel :deep(.reason-options button:hover){background:#f2eee4;border-color:#aea48b}.feedback-panel :deep(.close),.close{position:absolute;right:-8px;top:-5px;background:transparent;border:0;color:#938b7d;font-size:20px;width:28px;height:28px}.feedback-panel :deep(.reason-options){display:flex;gap:6px;margin-top:8px}.feedback-panel :deep(.reason-hint){display:none}.feedback-panel :deep(.reason-options button){padding:6px 10px;min-height:30px}.feedback-panel :deep(.skip){position:absolute;right:22px;top:2px;border:0;background:transparent;color:#918775;font-size:12px;padding:5px}.feedback-panel :deep(.thankyou){padding-top:5px}.feedback-panel :deep(.thanks-check){color:#788566;margin-right:8px}.feedback-panel :deep(.thankyou strong){font-size:14px}.toolbar-popover{position:absolute;right:120px;top:62px;width:295px;padding:23px;background:#fffefa;border:1px solid #dcd6c8;border-radius:10px;box-shadow:0 8px 30px #43382620;z-index:3}.toolbar-popover:before{content:'';position:absolute;right:54px;top:-6px;width:10px;height:10px;background:#fffefa;border-top:1px solid #dcd6c8;border-left:1px solid #dcd6c8;transform:rotate(45deg)}.toolbar-popover :deep(.question-content),.sidecard :deep(.question-content){display:block}.toolbar-popover :deep(.answer-options),.sidecard :deep(.answer-options){margin-top:17px}.toolbar-popover :deep(.reason-options),.sidecard :deep(.reason-options){flex-wrap:wrap}.toolbar-popover :deep(.skip),.sidecard :deep(.skip){position:static;margin-top:8px;padding-left:0}.toolbar-popover :deep(.reason-hint),.sidecard :deep(.reason-hint){display:block}.sidecard-space{width:258px;flex-shrink:0;padding:28px 22px;background:#f7f4ec;border-left:1px solid #e6dfd1;border-radius:0 0 12px 0;box-sizing:border-box}.sidecard-eyebrow{display:block;font-size:10px;color:#9c917a;letter-spacing:.08em;margin-bottom:17px}.sidecard :deep(.feedback-content){padding-right:0}.sidecard :deep(.close){right:-12px;top:-40px}.sidecard :deep(h2){font-size:16px;max-width:190px}.sidecard :deep(.answer-options){display:grid;grid-template-columns:1fr 1fr;gap:6px}.sidecard :deep(.answer-options button){padding:8px}.sidecard-placeholder{color:#a19784;margin-top:20px}.sidecard-placeholder>span{font-size:28px;color:#b2a68e}.sidecard-placeholder h2{font-size:15px;font-weight:500;margin-top:20px}.sidecard-placeholder p{font-size:12px;line-height:1.8}.source-panel{position:absolute;inset:20px;background:#f6f3ed;border:1px solid #dcd6c8;border-radius:8px;z-index:4;padding:20px;overflow:auto}.source-panel pre{font-size:12px;line-height:1.6}.source-panel .close{right:6px;top:6px}.example-menu{position:absolute;right:12px;top:12px;padding:8px;background:#fff;border:1px solid #ddd;border-radius:6px}.example-menu button{border:0;background:transparent;padding:7px}.render-error{color:#a34432}.prototype-tray{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);width:min(920px,calc(100vw - 50px));box-sizing:border-box;background:#262c34;color:#ebedf0;border:1px solid #434a55;border-radius:12px;box-shadow:0 10px 30px #15202f30;padding:12px 17px;z-index:20;font:11px ui-monospace,SFMono-Regular,monospace}.tray-top{display:flex;gap:9px;align-items:center}.tray-top strong{letter-spacing:.1em;font-size:9px;color:#acb6c5;margin-right:6px}.tray-top button{background:#353d48;border:1px solid #4a5361;color:#dbe1e9;border-radius:5px;padding:6px 9px;font-size:11px}.variant-options{display:flex;gap:5px}.variant-options button[aria-pressed=true]{background:#e5dfcf;border-color:#e5dfcf;color:#393b3a}.tray-top .restart{margin-left:auto;background:transparent}.state-row{margin-top:10px;color:#b1bac8}.state-row span{float:right;color:#8897ab}.event-row{margin-top:7px;color:#8494aa;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style>
