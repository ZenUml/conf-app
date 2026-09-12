import { createApp } from 'vue'
import store from '@/model/store2'
import { getView } from '@/model/globals/forgeGlobal'
import FeedbackDialog from './FeedbackDialog.vue'
import FeedbackHost from './FeedbackHost.vue'
import { deriveFeedbackContext, feedbackSurfaceForContext } from './feedbackContext'
import { requestFeedbackCapture } from './feedbackBridge'
import { createFeedbackTransport } from './feedbackTransport'
import type { FeedbackContext } from './feedbackSession'

const HOST_ID = 'zenuml-feedback-host'

export function installFeedbackHost(forgeContext: Record<string, any>): void {
  if (!feedbackSurfaceForContext(forgeContext) || document.getElementById(HOST_ID)) return
  const container = document.createElement('div')
  container.id = HOST_ID
  document.body.appendChild(container)
  const context = deriveFeedbackContext(forgeContext, store.state.diagram)
  createApp(FeedbackHost, { context }).mount(container)
}

function isFeedbackContext(value: unknown): value is FeedbackContext {
  if (!value || typeof value !== 'object') return false
  const context = value as Partial<FeedbackContext>
  return typeof context.surface === 'string'
    && typeof context.hostModule === 'string'
    && typeof context.userAccountId === 'string'
    && typeof context.clientDomain === 'string'
    && typeof context.macroUuid === 'string'
    && typeof context.contentId === 'string'
    && typeof context.customContentId === 'string'
}

export function mountFeedbackModal(forgeContext: Record<string, any>): boolean {
  const modal = forgeContext?.extension?.modal ?? {}
  if (modal.macroMode !== 'feedback' || !isFeedbackContext(modal.feedbackContext)) return false
  const container = document.getElementById('app')
  if (!container) throw new Error('Feedback modal root not found')
  const transport = createFeedbackTransport()
  const feedbackToken = typeof modal.feedbackToken === 'string' ? modal.feedbackToken : ''
  const captureCurrentView = feedbackToken && typeof BroadcastChannel !== 'undefined'
    ? () => requestFeedbackCapture(feedbackToken)
    : undefined
  const close = async () => { await (await getView()).close() }

  createApp(FeedbackDialog, {
    context: modal.feedbackContext,
    submit: transport.submit,
    handoff: transport.handoff,
    captureCurrentView,
    onClose: close,
  }).mount(container)
  return true
}
