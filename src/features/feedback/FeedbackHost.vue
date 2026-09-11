<template>
  <div
    v-if="!shouldSuppressDuringExport || !exportOpen"
    data-testid="feedback-edge"
    class="feedback-edge"
    :class="{ revealed, nudging }"
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
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import FeedbackDialog from './FeedbackDialog.vue'
import { captureFeedbackSurface } from './feedbackCapture'
import { serveFeedbackCapture } from './feedbackBridge'
import { feedbackAnalyticsProperties, type FeedbackContext } from './feedbackSession'
import { createFeedbackTransport } from './feedbackTransport'

const props = withDefaults(defineProps<{
  context: FeedbackContext
  openViewModal?: typeof openModal
  captureCurrentView?: typeof captureFeedbackSurface
  suppressDuringExport?: boolean
}>(), {
  suppressDuringExport: true,
})

const revealed = ref(false)
const nudging = ref(false)
const dialogOpen = ref(false)
const exportOpen = ref(false)
const transport = createFeedbackTransport()
const shouldSuppressDuringExport = props.suppressDuringExport
let observer: MutationObserver | undefined
let stopCaptureServer: (() => void) | undefined
let nudgeOpenTimer: ReturnType<typeof setTimeout> | undefined
let nudgeCloseTimer: ReturnType<typeof setTimeout> | undefined
const DISCOVERY_KEY = 'zenuml.feedback-trigger-discovered.v1'

function scheduleDiscoveryNudge() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  try {
    if (window.localStorage.getItem(DISCOVERY_KEY)) return
    window.localStorage.setItem(DISCOVERY_KEY, '1')
  } catch {
    // Storage can be unavailable in restricted Forge contexts; the nudge is non-essential.
    return
  }
  nudgeOpenTimer = setTimeout(() => { nudging.value = true }, 600)
  nudgeCloseTimer = setTimeout(() => { nudging.value = false }, 2400)
}

function inspectExport() {
  exportOpen.value = !!document.querySelector('.export-modal-backdrop')
}

onMounted(() => {
  scheduleDiscoveryNudge()
  inspectExport()
  observer = new MutationObserver(inspectExport)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] })
})
onBeforeUnmount(() => {
  observer?.disconnect()
  stopCaptureServer?.()
  clearTimeout(nudgeOpenTimer)
  clearTimeout(nudgeCloseTimer)
})

async function openFeedback() {
  trackAnalyticsEvent('feedback_report_opened', feedbackAnalyticsProperties(props.context))
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
.feedback-edge { position: fixed; z-index: 10002; right: 0; top: 50%; width: 104px; height: 40px; transform: translateY(-50%); overflow: visible; display: flex; justify-content: flex-end; }
.edge-trigger { width: 32px; height: 40px; padding: 0 0 0 8px; border: 0; border-radius: 6px 0 0 6px; background: #4b5563; color: #fff; font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; overflow: hidden; transition: width 150ms ease; cursor: pointer; display: flex; flex: none; align-items: center; justify-content: flex-start; gap: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.20); }
.edge-trigger svg { width: 16px; height: 16px; flex: none; }.edge-trigger span { white-space: nowrap; opacity: 0; transition: opacity 150ms ease; }
.feedback-edge:hover .edge-trigger, .feedback-edge.revealed .edge-trigger, .feedback-edge.nudging .edge-trigger, .edge-trigger:focus-visible { width: 104px; }
.feedback-edge:hover .edge-trigger span, .feedback-edge.revealed .edge-trigger span, .feedback-edge.nudging .edge-trigger span, .edge-trigger:focus-visible span { opacity: 1; }
.edge-trigger:focus-visible { outline: 0; box-shadow: 0 2px 8px rgba(0,0,0,.20), inset 0 0 0 2px #fff, inset 0 0 0 4px #2563eb; }
.feedback-overlay { position: fixed; z-index: 10001; inset: 0; display: flex; align-items: center; justify-content: flex-end; padding: 24px clamp(24px, 6vw, 80px); box-sizing: border-box; background: rgba(0,0,0,.5); }
@media (max-width: 760px) { .feedback-overlay { justify-content: center; padding: 16px; } }
@media (prefers-reduced-motion: reduce) { .edge-trigger,.edge-trigger span { transition: none; } }
</style>
