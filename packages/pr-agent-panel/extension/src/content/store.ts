/**
 * Page-side state for one GitHub tab: what the Hub says (status, state,
 * reviews, task events, message receipts) reduced to what the two Vue views
 * render. Pure and DOM-free apart from Vue reactivity, so it is unit-testable.
 */
import { computed, reactive } from 'vue'
import { repoKeyOf, type HubFrame, type PrRef, type PrState, type ReviewSummary, type Task } from '@zenuml/pr-panel-shared'
import type { HubStatusMessage } from '../bridge/messages'
import { DEFAULT_PREFS, type Prefs } from '../state/prefs'
import { visibleReviewsForViewer } from '../pr/ownership'
import type { PanelConnection, PanelMessageView } from '../ui/types'

type StateFrame = Extract<HubFrame, { type: 'state' }>

const MAX_MESSAGES = 100

export function createPageStore(documentId: string) {
  const state = reactive({
    status: { state: 'disabled' } as HubStatusMessage,
    hub: null as StateFrame | null,
    pr: null as PrRef | null,
    prState: 'unknown' as PrState,
    repoKey: null as string | null,
    reviews: [] as ReviewSummary[],
    viewerLogin: null as string | null,
    reviewsLoaded: false,
    prefs: { ...DEFAULT_PREFS } as Prefs,
    messages: [] as PanelMessageView[],
    dismissedTaskIds: [] as string[],
  })
  const lastSeq = new Map<string, number>()
  /** userMessage frame id → message view id, until `messageQueued` names the Hub's messageId. */
  const pendingByFrameId = new Map<string, string>()
  const viewByMessageId = new Map<string, string>()
  /** cancelTask frame id → taskId, so a Hub error about it can be shown as a note. */
  const pendingCancels = new Map<string, string>()

  const connection = computed<PanelConnection>(() => {
    if (state.status.state !== 'connected') return 'off'
    return state.hub?.activeDocumentId === documentId ? 'active' : 'inactive'
  })

  /** Tasks for the PR this tab shows now. A soft navigation keeps documentId, so documentId alone does not qualify a task. */
  const prTasks = computed<Task[]>(() => {
    const pr = state.pr
    if (!pr) return []
    const repoKey = repoKeyOf(pr)
    return (state.hub?.tasks ?? []).filter((t) => t.repoKey === repoKey && t.prNumber === pr.number)
  })

  /** The task the panel shows: a working one first, else the latest that the user has not dismissed. */
  const task = computed<Task | null>(() => {
    const visible = prTasks.value.filter((t) => !state.dismissedTaskIds.includes(t.taskId))
    const working = visible.filter((t) => t.status === 'working')
    const pool = working.length ? working : visible
    return pool.reduce<Task | null>((best, t) => (!best || t.startedAt > best.startedAt ? t : best), null)
  })

  const visibleReviews = computed(() => visibleReviewsForViewer(state.reviews, state.viewerLogin))

  /** The open PR's review for the Agent Panel. "My PRs" scopes the list only, never the PR the user is looking at. */
  const review = computed<ReviewSummary | null>(() => {
    const pr = state.pr
    if (!pr) return null
    return state.reviews.find((r) => r.prNumber === pr.number) ?? null
  })

  function pushMessage(m: PanelMessageView) {
    state.messages.push(m)
    if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES)
  }

  function isOurTask(taskId: string, frameDocumentId?: string): boolean {
    if (frameDocumentId && frameDocumentId !== documentId) return false
    if (prTasks.value.some((t) => t.taskId === taskId)) return true
    // An event for this tab can arrive before the state frame that lists its task; a task the
    // Hub already lists under another PR is not ours.
    return !!frameDocumentId && !(state.hub?.tasks ?? []).some((t) => t.taskId === taskId)
  }

  function applyFrame(frame: HubFrame): void {
    switch (frame.type) {
      case 'state':
        state.hub = frame
        return
      case 'reviews':
        if (state.repoKey && frame.repoKey === state.repoKey) {
          state.reviews = frame.items
          state.reviewsLoaded = true
        }
        return
      case 'taskEvent': {
        if (!isOurTask(frame.taskId, frame.documentId)) return
        const seen = lastSeq.get(frame.taskId)
        if (seen !== undefined && frame.seq <= seen) return
        lastSeq.set(frame.taskId, frame.seq)
        const ev = frame.event
        if (ev.kind === 'message') pushMessage({ id: `${frame.taskId}:${frame.seq}`, role: 'agent', text: ev.text })
        else if (ev.kind === 'progress') {
          const last = state.messages[state.messages.length - 1]
          if (!(last?.role === 'progress' && last.text === ev.text)) {
            pushMessage({ id: `${frame.taskId}:${frame.seq}`, role: 'progress', text: ev.text })
          }
        } else if (ev.kind === 'failed') pushMessage({ id: `${frame.taskId}:${frame.seq}`, role: 'progress', text: `Task failed: ${ev.reason}` })
        return
      }
      case 'messageQueued': {
        const viewId = pendingByFrameId.get(frame.inReplyTo)
        if (!viewId) return
        pendingByFrameId.delete(frame.inReplyTo)
        viewByMessageId.set(frame.messageId, viewId)
        const view = state.messages.find((m) => m.id === viewId)
        if (view && view.status !== 'delivered') {
          view.status = 'queued'
          view.waitingForAgent = frame.waitingForAgent
        }
        return
      }
      case 'messageDelivered': {
        const viewId = viewByMessageId.get(frame.messageId)
        const view = viewId ? state.messages.find((m) => m.id === viewId) : undefined
        if (view) {
          view.status = 'delivered'
          view.waitingForAgent = false
        }
        return
      }
      case 'error': {
        const sentViewId = frame.inReplyTo ? pendingByFrameId.get(frame.inReplyTo) : undefined
        if (sentViewId && frame.inReplyTo) {
          pendingByFrameId.delete(frame.inReplyTo)
          const view = state.messages.find((m) => m.id === sentViewId)
          if (view) view.status = undefined
          pushMessage({ id: `err:${frame.id}`, role: 'progress', text: `Not sent: ${frame.message}` })
          return
        }
        // Non-fatal: Stop on a task that is gone or already ended.
        const taskId = frame.inReplyTo ? pendingCancels.get(frame.inReplyTo) : undefined
        if (!taskId || !frame.inReplyTo) return
        pendingCancels.delete(frame.inReplyTo)
        if (frame.code === 'unknown_task' || frame.code === 'task_not_cancellable') {
          pushMessage({ id: `err:${frame.id}`, role: 'progress', text: 'That task has already ended.' })
          dismissTask(taskId)
        }
        return
      }
      default:
        return
    }
  }

  /** Records a message the user just sent; `frameId` is the userMessage frame's id. */
  function addUserMessage(frameId: string, text: string): void {
    const id = `user:${frameId}`
    pendingByFrameId.set(frameId, id)
    pushMessage({ id, role: 'user', text, status: 'sending' })
  }

  /** Records a Stop click; `frameId` is the cancelTask frame's id. */
  function noteCancel(frameId: string, taskId: string): void {
    pendingCancels.set(frameId, taskId)
  }

  function dismissTask(taskId: string): void {
    if (!state.dismissedTaskIds.includes(taskId)) state.dismissedTaskIds.push(taskId)
  }

  return { state, connection, task, review, visibleReviews, applyFrame, addUserMessage, noteCancel, dismissTask }
}

export type PageStore = ReturnType<typeof createPageStore>
