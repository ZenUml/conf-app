<template>
  <div
    v-if="!shouldSuppressDuringExport || !exportOpen"
    data-testid="feedback-edge"
    class="feedback-edge"
    :class="{ revealed }"
    @mouseenter="revealed = true"
    @mouseleave="revealed = false"
    @focusin="revealed = true"
    @focusout="revealed = false"
  >
    <button data-testid="feedback-trigger" class="edge-trigger" type="button" aria-label="Send feedback" @click="openFeedback">
      <ChatBubbleOvalLeftEllipsisIcon aria-hidden="true" />
      <span>Feedback</span>
    </button>
  </div>
  <div v-if="dialogOpen && context.surface !== 'viewer'" class="feedback-overlay">
    <FeedbackDialog
      :context="context"
      :submit="transport.submit"
      :handoff="transport.handoff"
      :capture-current-view="captureCurrentView ?? captureFeedbackSurface"
      @close="closeDialog"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ChatBubbleOvalLeftEllipsisIcon from '@heroicons/vue/24/outline/ChatBubbleOvalLeftEllipsisIcon'
import { openModal } from '@/model/globals/forgeGlobal'
import FeedbackDialog from './FeedbackDialog.vue'
import { captureFeedbackSurface } from './feedbackCapture'
import { serveFeedbackCapture } from './feedbackBridge'
import type { FeedbackContext } from './feedbackSession'
import { createFeedbackTransport } from './feedbackTransport'

const props = defineProps<{
  context: FeedbackContext
  openViewModal?: typeof openModal
  captureCurrentView?: typeof captureFeedbackSurface
  suppressDuringExport?: boolean
}>()

const revealed = ref(false)
const dialogOpen = ref(false)
const exportOpen = ref(false)
const transport = createFeedbackTransport()
const shouldSuppressDuringExport = props.suppressDuringExport !== false
let observer: MutationObserver | undefined
let stopCaptureServer: (() => void) | undefined

function inspectExport() {
  exportOpen.value = !!document.querySelector('.export-modal-backdrop')
}

onMounted(() => {
  inspectExport()
  observer = new MutationObserver(inspectExport)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] })
})
onBeforeUnmount(() => { observer?.disconnect(); stopCaptureServer?.() })

async function openFeedback() {
  if (props.context.surface !== 'viewer') {
    dialogOpen.value = true
    return
  }
  const feedbackToken = crypto.randomUUID()
  stopCaptureServer?.()
  if (typeof BroadcastChannel !== 'undefined') {
    stopCaptureServer = serveFeedbackCapture(feedbackToken, props.captureCurrentView ?? captureFeedbackSurface)
  }
  await (props.openViewModal ?? openModal)({
    resource: 'main',
    size: 'medium',
    context: {
      macroMode: 'feedback',
      feedbackToken,
      feedbackContext: props.context,
    },
    onClose: () => stopCaptureServer?.(),
  })
}

function closeDialog() { dialogOpen.value = false }
</script>

<style scoped>
.feedback-edge { position: fixed; z-index: 10002; right: 0; top: 50%; width: 100px; height: 152px; transform: translateY(-50%); overflow: visible; }
.edge-trigger { position: absolute; right: 0; top: 0; width: 44px; height: 152px; padding: 0; border: 0; border-radius: 6px 0 0 6px; background: #4b5563; color: #fff; font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; letter-spacing: .025em; opacity: 0; pointer-events: none; transition: opacity 150ms ease, transform 150ms ease; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; box-shadow: 0 2px 8px rgba(0,0,0,.20); }
.edge-trigger svg { width: 18px; height: 18px; flex: none; }.edge-trigger span { writing-mode: vertical-rl; transform: rotate(180deg); }
.feedback-edge:hover .edge-trigger, .feedback-edge.revealed .edge-trigger, .edge-trigger:focus-visible { opacity: 1; pointer-events: auto; }
.edge-trigger:focus-visible { outline: 0; box-shadow: 0 2px 8px rgba(0,0,0,.20), inset 0 0 0 2px #fff, inset 0 0 0 4px #2563eb; }
.feedback-overlay { position: fixed; z-index: 10001; inset: 0; display: flex; align-items: center; justify-content: flex-end; padding: 24px clamp(24px, 6vw, 80px); box-sizing: border-box; background: rgba(0,0,0,.5); }
@media (max-width: 760px) { .feedback-overlay { justify-content: center; padding: 16px; } }
@media (prefers-reduced-motion: reduce) { .edge-trigger { transition-duration: .01ms; } }
</style>
