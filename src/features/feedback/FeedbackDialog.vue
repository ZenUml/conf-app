<template>
  <section
    class="feedback-dialog"
    :class="{ 'feedback-dialog--forge-modal': context.surface === 'viewer' }"
    role="dialog"
    aria-modal="true"
    aria-labelledby="feedback-title"
    tabindex="-1"
    @keydown.esc.stop.prevent="close('escape')"
  >
    <header class="feedback-header">
      <h2 id="feedback-title">Send feedback</h2>
      <button class="icon-button" type="button" aria-label="Close feedback" @click="close('close_button')"><XMarkIcon aria-hidden="true" /></button>
    </header>

    <div v-if="state === 'succeeded'" class="success-state" aria-live="polite">
      <div class="success-mark" aria-hidden="true">✓</div>
      <h3>Your feedback has been saved.</h3>
      <p>Reference <strong>{{ session.reportReference }}</strong></p>
      <p v-if="handoffCountdown > 0">
        You’ll be redirected to our ticket system in {{ handoffCountdown }} {{ handoffCountdown === 1 ? 'second' : 'seconds' }}.
      </p>
      <p v-if="handoffCountdown > 0">Submit the ticket if you'd like to receive replies.</p>
      <a
        v-if="manualSupportUrl"
        :href="manualSupportUrl"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="continue-support"
      >Continue to support</a>
      <button type="button" class="primary-button" @click="$emit('close')">Done</button>
    </div>

    <form v-else class="feedback-form" @submit.prevent="send">
      <div class="feedback-body">
        <div class="writing-surface">
          <label class="sr-only" for="feedback-description">Describe your feedback</label>
          <textarea
            id="feedback-description"
            ref="textareaElement"
            v-model="description"
            rows="10"
            maxlength="10000"
            placeholder="What would you like us to know?"
            autofocus
            @keydown.enter="onTextareaEnter"
          />
        </div>
        <p v-if="state === 'failed'" class="error-message" role="alert">
          {{ session.errorMessage }} You can also email
          <a href="mailto:support@zenuml.com">support@zenuml.com</a>.
        </p>
        <p v-else-if="session.errorMessage" class="error-message" role="alert">{{ session.errorMessage }}</p>
        <p v-else-if="imageError" class="error-message" role="alert">{{ imageError }}</p>

      <div class="image-actions">
        <template v-if="!screenshot">
          <button
            type="button"
            class="secondary-button"
            data-testid="capture-current-view"
            :disabled="captureBusy || !captureCurrentView"
            aria-describedby="capture-help"
            title="Captures only this ZenUML view — never the Confluence page or browser. You can preview, retake or remove it before sending."
            @click="captureView"
          ><CameraIcon class="image-action-icon" aria-hidden="true" />{{ captureBusy ? 'Capturing…' : 'Capture current view' }}</button>
          <label class="secondary-button upload-button">
            <ArrowUpTrayIcon class="image-action-icon" aria-hidden="true" />
            Upload image
            <input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" @change="uploadImage">
          </label>
          <span id="capture-help" class="sr-only">Captures only the current ZenUML surface and shows a preview before sending.</span>
        </template>
        <template v-else>
          <span class="image-preview-thumbnail"><img :src="screenshot.dataUrl" alt="Captured view"></span>
          <div class="image-preview-copy">
            <strong>{{ screenshot.method === 'current_view' ? 'Current view captured' : 'Image uploaded' }}</strong>
            <span>{{ imageFormatLabel }} · one image per report</span>
          </div>
          <div class="image-preview-actions">
            <label class="text-button replace-button">Replace<input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" @change="uploadImage"></label>
            <button type="button" class="text-button" @click="captureView">Retake</button>
            <button type="button" class="text-button" data-testid="remove-screenshot" @click="removeScreenshot">Remove</button>
          </div>
        </template>
      </div>

        <div class="context-details">
          <button class="context-disclosure" type="button" :aria-expanded="contextExpanded" @click="toggleContextDetails">
            <svg aria-hidden="true" viewBox="0 0 12 12" :class="{ expanded: contextExpanded }"><path d="M2.5 4.5L6 8L9.5 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
            8 fields attached automatically
          </button>
          <dl v-if="contextExpanded" ref="fieldsPanel">
          <template v-for="item in contextItems" :key="item.label">
            <dt>{{ item.label }}</dt><dd :class="{ unavailable: item.unavailable }" :title="item.value">{{ item.value }}</dd>
          </template>
          </dl>
        </div>
      </div>

      <footer>
        <button type="button" class="secondary-button" @click="close('cancel_button')">Cancel</button>
        <button type="submit" class="primary-button" data-testid="send-feedback" :disabled="state === 'submitting'">
          {{ state === 'submitting' ? 'Saving…' : 'Send feedback' }}
        </button>
      </footer>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import CameraIcon from '@heroicons/vue/24/outline/CameraIcon'
import ArrowUpTrayIcon from '@heroicons/vue/24/outline/ArrowUpTrayIcon'
import XMarkIcon from '@heroicons/vue/24/outline/XMarkIcon'
import type { FeedbackDismissReason } from '@/utils/analytics/catalog'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { createFeedbackSession, type FeedbackContext, type FeedbackReportPayload, type FeedbackScreenshot } from './feedbackSession'
import { continueMarkdownList } from './markdownTextarea'

const props = defineProps<{
  context: FeedbackContext
  submit: (payload: FeedbackReportPayload & { submissionId: string }) => Promise<{ reportReference: string }>
  handoff?: (reference: string) => Promise<{ opened: boolean, manualUrl?: string }>
  captureCurrentView?: () => Promise<FeedbackScreenshot>
}>()
const emit = defineEmits<{ close: [] }>()

const session = createFeedbackSession({
  context: props.context,
  submit: props.submit,
  handoff: props.handoff,
  track: trackAnalyticsEvent,
})
const description = ref('')
const screenshot = ref<FeedbackScreenshot>()
const state = ref(session.submissionState)
const captureBusy = ref(false)
const imageError = ref('')
const textareaElement = ref<HTMLTextAreaElement>()
const contextExpanded = ref(false)
const fieldsPanel = ref<HTMLElement>()
const handoffCountdown = ref(0)
const manualSupportUrl = ref('')
let handoffTimer: ReturnType<typeof setInterval> | undefined

const imageFormatLabel = computed(() => {
  const extension = screenshot.value?.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toUpperCase()
  if (extension) return extension === 'JPG' ? 'JPEG' : extension
  const mimeType = screenshot.value?.dataUrl.match(/^data:image\/([^;,]+)/)?.[1]?.toUpperCase()
  return mimeType === 'JPEG' ? 'JPEG' : (mimeType || 'Image')
})

const contextItems = computed(() => [
  { label: 'Surface', value: props.context.surface },
  { label: 'Host module', value: props.context.hostModule },
  { label: 'Diagram type', value: props.context.diagramType },
  { label: 'Diagram title', value: props.context.diagramTitle },
  { label: 'User account ID', value: props.context.userAccountId },
  { label: 'Client domain', value: props.context.clientDomain },
  { label: 'Space name', value: props.context.spaceName },
  { label: 'Macro UUID', value: props.context.macroUuid },
].map(item => ({ ...item, unavailable: /^(Not |—$)/.test(item.value) })))

onMounted(async () => {
  await nextTick()
  textareaElement.value?.focus()
})

onBeforeUnmount(() => clearInterval(handoffTimer))

async function toggleContextDetails() {
  contextExpanded.value = !contextExpanded.value
  if (!contextExpanded.value) return
  await nextTick()
  fieldsPanel.value?.scrollIntoView?.({ block: 'nearest' })
}

async function captureView() {
  if (!props.captureCurrentView) return
  captureBusy.value = true
  imageError.value = ''
  const captured = await session.capture('current_view', props.captureCurrentView)
  screenshot.value = session.screenshot
  if (!captured) imageError.value = 'The current view could not be captured. You can upload an image instead.'
  captureBusy.value = false
}

function readFile(file: File): Promise<FeedbackScreenshot> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    return Promise.reject(new Error('InvalidFeedbackImage'))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('ImageReadError'))
    reader.onload = () => resolve({ dataUrl: String(reader.result), name: file.name, method: 'upload' })
    reader.readAsDataURL(file)
  })
}

async function uploadImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  imageError.value = ''
  const uploaded = await session.capture('upload', () => readFile(file))
  screenshot.value = session.screenshot
  if (!uploaded) imageError.value = 'Choose a PNG, JPEG, or WebP image smaller than 5 MB.'
  ;(event.target as HTMLInputElement).value = ''
}

function removeScreenshot() {
  session.removeScreenshot()
  screenshot.value = undefined
  imageError.value = ''
}

async function onTextareaEnter(event: KeyboardEvent) {
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.currentTarget as HTMLTextAreaElement
  const continuation = continueMarkdownList(description.value, target.selectionStart, target.selectionEnd)
  if (!continuation) return
  event.preventDefault()
  description.value = continuation.value
  await nextTick()
  textareaElement.value?.setSelectionRange(continuation.cursor, continuation.cursor)
}

function close(reason: FeedbackDismissReason) {
  session.dismiss(reason)
  emit('close')
}

async function send() {
  session.setDescription(description.value)
  state.value = 'submitting'
  const succeeded = await session.submit()
  state.value = session.submissionState
  if (!succeeded) state.value = 'failed'
  else if (props.handoff) startHandoffCountdown()
}

function startHandoffCountdown() {
  handoffCountdown.value = 5
  clearInterval(handoffTimer)
  handoffTimer = setInterval(async () => {
    handoffCountdown.value -= 1
    if (handoffCountdown.value > 0) return
    clearInterval(handoffTimer)
    await session.handoffToSupport()
    manualSupportUrl.value = session.manualSupportUrl
  }, 1_000)
}
</script>

<style scoped>
.feedback-dialog { width: min(600px, calc(100vw - 32px)); height: min(520px, calc(100vh - 32px)); box-sizing: border-box; display: flex; flex-direction: column; background: #fff; color: #172b4d; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 20px 25px -5px rgba(0,0,0,.10), 0 8px 10px -6px rgba(0,0,0,.10); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; overflow: hidden; }
.feedback-dialog--forge-modal { width: 100vw; height: 100vh; border: 0; border-radius: 0; box-shadow: none; }
.feedback-header { box-sizing: border-box; height: 48px; padding: 0 10px 0 20px; display: flex; align-items: center; gap: 10px; justify-content: space-between; border-bottom: 1px solid #e5e7eb; flex: 0 0 auto; }
.feedback-header h2 { flex: 1; margin: 0; font-size: 14px; line-height: 1.4; font-weight: 600; letter-spacing: -.005em; }
.icon-button { width: 32px; height: 32px; padding: 0; border: 0; border-radius: 6px; display: flex; align-items: center; justify-content: center; background: transparent; cursor: pointer; color: #6b7280; transition: background 200ms ease, color 200ms ease; }
.icon-button:hover { background: #f3f4f6; color: #374151; }.icon-button:focus-visible { outline: 0; box-shadow: 0 0 0 2px #fff, 0 0 0 3px #2563eb; }.icon-button svg { width: 16px; height: 16px; }
.feedback-form { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.feedback-body { padding: 20px; display: flex; flex-direction: column; gap: 18px; flex: 1; min-height: 0; overflow-y: auto; }
.writing-surface { flex: 0 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #fff; transition: border-color 200ms ease; }
textarea { display: block; width: 100%; height: 238px; resize: none; box-sizing: border-box; border: 0; border-radius: 7px; padding: 14px 16px; background: transparent; font: 400 14px/19.6px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: inherit; white-space: pre-wrap; }
.writing-surface:focus-within { border-color: #3b82f6; box-shadow: 0 0 0 1px #3b82f6; }
textarea:focus { outline: 0; }
.image-actions { display: flex; align-items: center; gap: 12px; }
.image-preview-thumbnail { flex: none; width: 76px; height: 48px; border: 1px solid #e5e7eb; border-radius: 4px; background: #fff; overflow: hidden; position: relative; }.image-preview-thumbnail img { position: absolute; inset: 0; width: 76px; height: 48px; object-fit: cover; object-position: center top; }
.image-preview-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; }.image-preview-copy strong { font-size: 13px; line-height: 1.4; font-weight: 500; }.image-preview-copy span { margin-top: 2px; color: #6b778c; font-size: 11px; }
.image-preview-actions { display: flex; align-items: center; }.replace-button { display: inline-flex; cursor: pointer; }
.primary-button, .secondary-button, .text-button { display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; padding: 8px 12px; border: 0; font-family: inherit; font-size: 14px; line-height: 1.4; font-weight: 500; cursor: pointer; transition: background 200ms ease, color 200ms ease; }
.primary-button { background: #2563eb; color: white; }
.secondary-button { border: 1px solid #d1d5db; background: white; color: #374151; font-size: 13px; }
.text-button { border: 0; background: transparent; color: #6b7280; padding: 6px 10px; }
.primary-button:hover { background: #1d4ed8; }.secondary-button:hover { background: #f9fafb; }.text-button:hover { background: #f3f4f6; color: #374151; }
.primary-button:disabled,.secondary-button:disabled { border: 0; background: #d1d5db; color: #fff; cursor: not-allowed; }
.primary-button:focus-visible,.secondary-button:focus-visible,.text-button:focus-visible { outline: 0; box-shadow: 0 0 0 2px #fff, 0 0 0 3px #3b82f6; }
.image-action-icon { width: 15px; height: 15px; flex: none; }
.upload-button { display: inline-flex; }
.context-disclosure { display: inline-flex; align-items: center; gap: 6px; padding: 3px 6px 3px 0; margin-left: -2px; border: 0; border-radius: 4px; background: transparent; color: #6b778c; cursor: pointer; font: 500 12px/1.4 inherit; transition: color 200ms ease; }.context-disclosure:hover,.context-disclosure[aria-expanded="true"] { color: #172b4d; }.context-disclosure:focus-visible { outline: 0; box-shadow: 0 0 0 2px #fff, 0 0 0 3px #3b82f6; }.context-disclosure svg { width: 12px; height: 12px; flex: none; transition: transform 150ms ease; }.context-disclosure svg.expanded { transform: rotate(180deg); }
.context-details dl { margin: 10px 0 0; padding: 12px 14px; border-radius: 6px; background: #f9fafb; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 20px; font-size: 11px; }
.context-details dt { color: #6b778c; }.context-details dd { min-width: 0; margin: 0; text-align: right; color: #172b4d; font: 400 11px/1.5 Menlo, "Fira Code", Monaco, "source-code-pro", "Ubuntu Mono", "DejaVu Sans Mono", Consolas, monospace; word-break: break-word; }
.context-details dd.unavailable { color: #9ca3af; }
.error-message { margin: -10px 0 0; color: #ca3521; font-size: 12px; }
footer { box-sizing: border-box; flex: none; height: 52px; padding: 0 20px; border-top: 1px solid #e5e7eb; background: #f9fafb; display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.success-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 32px 64px; gap: 10px; }
.success-state h3,.success-state p { margin: 0; }.success-mark { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: #dffcf0; color: #216e4e; font-size: 24px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-height: 560px) { .feedback-dialog:not(.feedback-dialog--forge-modal) { height: calc(100vh - 16px); } textarea { height: min(238px, 42vh); } .feedback-body { gap: 12px; padding: 16px 20px; } }
</style>
