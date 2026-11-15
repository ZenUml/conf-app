<template>
  <div
    v-if="!shouldSuppressDuringExport || !exportOpen"
    data-testid="feedback-edge"
    class="feedback-edge"
    :class="{ revealed, nudging, 'has-comments': showComments }"
    @mouseenter="onEdgeEnter"
    @mouseleave="revealed = false"
    @focusin="revealed = true"
    @focusout="revealed = false"
  >
    <button
      v-if="showComments"
      data-testid="comments-trigger"
      class="edge-trigger"
      type="button"
      aria-label="Comments"
      @click="openComments"
    >
      <ChatBubbleLeftRightIcon aria-hidden="true" />
      <span>{{ commentsLabel }}</span>
    </button>
    <button
      data-testid="feedback-trigger"
      class="edge-trigger"
      type="button"
      :aria-label="showComments ? 'Report a bug' : 'Send feedback'"
      @click="openFeedback"
    >
      <BugAntIcon v-if="showComments" aria-hidden="true" />
      <ChatBubbleOvalLeftEllipsisIcon v-else aria-hidden="true" />
      <span>{{ showComments ? 'Report a bug' : 'Feedback' }}</span>
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import BugAntIcon from '@heroicons/vue/24/outline/BugAntIcon'
import ChatBubbleLeftRightIcon from '@heroicons/vue/24/outline/ChatBubbleLeftRightIcon'
import ChatBubbleOvalLeftEllipsisIcon from '@heroicons/vue/24/outline/ChatBubbleOvalLeftEllipsisIcon'
import { openModal } from '@/model/globals/forgeGlobal'
import { getSessionReplayId, registerAnalyticsSuperProperties, trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { COMMENTS_MACRO_MODE } from '@/features/diagramComments/commentsMode'
import { commentsContext, readCommentsContext } from '@/features/diagramComments/commentsContextStore'
import type { CommentsEntryConfig } from '@/features/diagramComments/commentsEntry'
import { nativeThreadPath, replyFromClosePayload } from '@/features/diagramComments/nativeThread'
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
  /** Comments entry (#1047). Absent = no Comments button and the feedback button keeps its name. */
  comments?: CommentsEntryConfig
}>(), {
  suppressDuringExport: true,
})

const revealed = ref(false)
const commentCount = ref<number | null>(null)
let commentCountRequested = false
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

// Comments shows on the viewer surface only, for licensed and guest viewers, once
// the viewer has published the diagram's id. Anonymous viewers have no account id.
const showComments = computed(() => {
  const c = props.comments
  return !!c?.enabled
    && props.context.surface === 'viewer'
    && !!c.pageId
    && !!c.pageUrl
    && !!c.accountId
    && !!commentsContext.diagramId
})
const commentsLabel = computed(() => (commentCount.value === null ? 'Comments' : `Comments · ${commentCount.value}`))

// The count is a courtesy: read on the first pointer entry, never on load, and a
// failure leaves the plain label. It must not touch the render or raise an error.
async function defaultLoadCount(pageId: string, diagramId: string): Promise<number> {
  const [{ diagramCommentCount }, { requestConfluenceJson }] = await Promise.all([
    import('@/features/diagramComments/pageCommentsCache'),
    import('@/utils/byline/confluenceRequest'),
  ])
  return diagramCommentCount(requestConfluenceJson as any, pageId, diagramId)
}

function onEdgeEnter() {
  revealed.value = true
  const c = props.comments
  const diagramId = commentsContext.diagramId
  if (commentCountRequested || !showComments.value || !c || !diagramId) return
  commentCountRequested = true
  Promise.resolve()
    .then(() => (c.loadCount ?? defaultLoadCount)(c.pageId, diagramId))
    .then((n) => { commentCount.value = n })
    .catch(() => { /* label stays "Comments" */ })
}

async function defaultNavigate(path: string) {
  const { router } = await import('@forge/bridge')
  await router.navigate(path)
}

async function openComments() {
  const c = props.comments
  // Read at click time: the viewer publishes version, title and last editor after load.
  const snapshot = readCommentsContext()
  if (!c || !snapshot || !c.pageId) return
  trackAnalyticsEvent('diagram_comment_entry_clicked', {
    feature_area: 'diagram_comments',
    surface: 'viewer',
    macro_type: snapshot.macroType ?? 'none',
    comment_viewer_kind: c.viewerKind ?? 'unknown',
  })
  const modalContext: Record<string, unknown> = {
    pageId: c.pageId,
    pageUrl: c.pageUrl,
    ...(c.localId ? { localId: c.localId } : {}),
    diagramId: snapshot.diagramId,
    ...(snapshot.diagramVersion !== undefined ? { diagramVersion: snapshot.diagramVersion } : {}),
    ...(snapshot.diagramTitle ? { diagramTitle: snapshot.diagramTitle } : {}),
    ...(snapshot.lastModifierId ? { lastModifierId: snapshot.lastModifierId } : {}),
    ...(c.accountId ? { currentAccountId: c.accountId } : {}),
    ...(snapshot.macroType ? { macroType: snapshot.macroType } : {}),
  }
  await (props.openViewModal ?? openModal)({
    resource: 'main',
    size: 'medium',
    context: { macroMode: COMMENTS_MACRO_MODE, commentsContext: modalContext },
    // Fallback for "Reply in Confluence": the modal could not navigate the host
    // page itself, so it closed with { action: 'reply', commentId } for us to act on.
    onClose: (payload?: unknown) => {
      const reply = replyFromClosePayload(payload)
      const path = reply ? nativeThreadPath(c.pageUrl, reply.commentId) : null
      if (path) void Promise.resolve((c.navigate ?? defaultNavigate)(path)).catch(() => undefined)
    },
  })
}

async function openFeedback() {
  trackAnalyticsEvent('feedback_report_opened', {
    ...feedbackAnalyticsProperties(props.context),
    feedback_entry_label: showComments.value ? 'report_a_bug' : 'feedback',
  })
  if (props.context.surface !== 'viewer') {
    dialogOpen.value = true
    return
  }
  const feedbackToken = crypto.randomUUID()
  // trackAnalyticsEvent above starts the viewer recording once init settles;
  // the helper waits for that, then reads the replay id for the modal to echo.
  void registerAnalyticsSuperProperties({ feedback_token: feedbackToken })
  const viewerReplayId = await getSessionReplayId()
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
      ...(viewerReplayId ? { viewerReplayId } : {}),
      feedbackContext: props.context,
    },
    onClose: () => stopCaptureServer?.(),
  })
}

function closeDialog() { dialogOpen.value = false }
</script>

<style scoped>
.feedback-edge { position: fixed; z-index: 10002; right: 0; top: 50%; transform: translateY(-50%); overflow: visible; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.edge-trigger { width: 32px; height: 40px; padding: 0 0 0 8px; border: 0; border-radius: 6px 0 0 6px; background: #4b5563; color: #fff; font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; overflow: hidden; transition: width 150ms ease; cursor: pointer; display: flex; flex: none; align-items: center; justify-content: flex-start; gap: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.20); }
.edge-trigger svg { width: 16px; height: 16px; flex: none; }.edge-trigger span { white-space: nowrap; opacity: 0; transition: opacity 150ms ease; }
.feedback-edge:hover .edge-trigger, .feedback-edge.revealed .edge-trigger, .feedback-edge.nudging .edge-trigger, .edge-trigger:focus-visible { width: 104px; }
.feedback-edge:hover .edge-trigger span, .feedback-edge.revealed .edge-trigger span, .feedback-edge.nudging .edge-trigger span, .edge-trigger:focus-visible span { opacity: 1; }
.feedback-edge.has-comments:hover .edge-trigger, .feedback-edge.has-comments.revealed .edge-trigger, .feedback-edge.has-comments.nudging .edge-trigger, .feedback-edge.has-comments .edge-trigger:focus-visible { width: 136px; }
.edge-trigger:focus-visible { outline: 0; box-shadow: 0 2px 8px rgba(0,0,0,.20), inset 0 0 0 2px #fff, inset 0 0 0 4px #2563eb; }
.feedback-overlay { position: fixed; z-index: 10001; inset: 0; display: flex; align-items: center; justify-content: flex-end; padding: 24px clamp(24px, 6vw, 80px); box-sizing: border-box; background: rgba(0,0,0,.5); }
@media (max-width: 760px) { .feedback-overlay { justify-content: center; padding: 16px; } }
@media (prefers-reduced-motion: reduce) { .edge-trigger,.edge-trigger span { transition: none; } }
</style>
