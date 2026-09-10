<template>
  <section class="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title" tabindex="-1" @keydown.esc.stop.prevent="close('escape')">
    <header class="feedback-header">
      <h2 id="feedback-title">Send feedback</h2>
      <button class="icon-button" type="button" aria-label="Close feedback" @click="close('close_button')">×</button>
    </header>

    <div v-if="state === 'succeeded'" class="success-state" aria-live="polite">
      <div class="success-mark" aria-hidden="true">✓</div>
      <h3>Your feedback has been saved.</h3>
      <p>Reference <strong>{{ session.reportReference }}</strong></p>
      <p>We opened our support form so you can add your email if you want a reply. The support form is only for contact and replies; your feedback is already safe.</p>
      <a
        v-if="session.manualSupportUrl"
        :href="session.manualSupportUrl"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="continue-support"
      >Continue to support</a>
      <button type="button" class="primary-button" @click="$emit('close')">Done</button>
    </div>

    <form v-else class="feedback-form" @submit.prevent="send">
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
      <p v-if="session.errorMessage" class="error-message" role="alert">{{ session.errorMessage }}</p>
      <p v-else-if="imageError" class="error-message" role="alert">{{ imageError }}</p>

      <div class="image-actions">
        <template v-if="!screenshot">
          <button
            type="button"
            class="secondary-button"
            data-testid="capture-current-view"
            :disabled="captureBusy || !captureCurrentView"
            aria-describedby="capture-help"
            @click="captureView"
          >{{ captureBusy ? 'Capturing…' : 'Capture current view' }}</button>
          <label class="secondary-button upload-button">
            Upload image
            <input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" @change="uploadImage">
          </label>
          <span id="capture-help" class="sr-only">Captures only the current ZenUML surface and shows a preview before sending.</span>
        </template>
        <template v-else>
          <img :src="screenshot.dataUrl" alt="Captured view">
          <div class="image-preview-copy">
            <strong>{{ screenshot.method === 'current_view' ? 'Current view captured' : 'Image uploaded' }}</strong>
            <span>One image · stored privately for 30 days</span>
          </div>
          <div class="image-preview-actions">
            <label class="text-button replace-button">Replace<input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" @change="uploadImage"></label>
            <button type="button" class="text-button" @click="captureView">Retake</button>
            <button type="button" class="text-button danger" data-testid="remove-screenshot" @click="removeScreenshot">Remove</button>
          </div>
        </template>
      </div>

      <details class="context-details">
        <summary>8 fields attached automatically</summary>
        <dl>
          <template v-for="item in contextItems" :key="item.label">
            <dt>{{ item.label }}</dt><dd :title="item.value">{{ item.value }}</dd>
          </template>
        </dl>
      </details>

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
import { computed, nextTick, onMounted, ref } from 'vue'
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

const contextItems = computed(() => [
  { label: 'Surface', value: props.context.surface },
  { label: 'Host module', value: props.context.hostModule },
  { label: 'Diagram type', value: props.context.diagramType },
  { label: 'Diagram title', value: props.context.diagramTitle },
  { label: 'User account ID', value: props.context.userAccountId },
  { label: 'Client domain', value: props.context.clientDomain },
  { label: 'Space', value: props.context.spaceName },
  { label: 'Macro UUID', value: props.context.macroUuid },
])

onMounted(async () => {
  session.open()
  await nextTick()
  textareaElement.value?.focus()
})

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
}
</script>

<style scoped>
.feedback-dialog { width: min(600px, calc(100vw - 32px)); height: min(520px, calc(100vh - 32px)); box-sizing: border-box; display: flex; flex-direction: column; background: #fff; color: #172b4d; border: 1px solid #dcdfe4; border-radius: 10px; box-shadow: 0 12px 36px rgba(9, 30, 66, .24); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow: hidden; }
.feedback-header { height: 52px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #dfe1e6; flex: 0 0 auto; }
.feedback-header h2 { margin: 0; font-size: 17px; line-height: 24px; font-weight: 600; }
.icon-button { border: 0; background: transparent; font-size: 26px; line-height: 1; cursor: pointer; color: #44546f; }
.feedback-form { padding: 14px 20px 0; display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; }
.writing-surface { height: 240px; border: 1px solid #8590a2; border-radius: 7px; overflow: hidden; display: flex; flex-direction: column; background: #fff; }
textarea { width: 100%; flex: 1; min-height: 0; resize: none; box-sizing: border-box; border: 0; border-radius: 7px; padding: 14px 16px; font: 400 14px/19.6px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: inherit; white-space: pre-wrap; }
.writing-surface:focus-within { border-color: #0c66e4; box-shadow: 0 0 0 1px #0c66e4; }
textarea:focus { outline: 0; }
.image-actions { min-height: 54px; display: flex; align-items: center; gap: 10px; }
.image-actions img { width: 84px; height: 50px; border: 1px solid #dfe1e6; border-radius: 5px; object-fit: cover; }
.image-preview-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; font-size: 12px; }.image-preview-copy span { color: #626f86; }
.image-preview-actions { display: flex; align-items: center; gap: 2px; }.replace-button { display: inline-flex; cursor: pointer; }
.primary-button, .secondary-button, .text-button { border-radius: 4px; padding: 8px 12px; font: inherit; font-weight: 600; cursor: pointer; }
.primary-button { border: 1px solid #0c66e4; background: #0c66e4; color: white; }
.secondary-button { border: 1px solid #b6c2cf; background: white; color: #172b4d; }
.text-button { border: 0; background: transparent; color: #0c66e4; }
.danger { color: #ae2a19; }
.upload-button { display: inline-flex; }
.context-details { border: 1px solid #dcdfe4; border-radius: 6px; background: #f7f8f9; padding: 8px 10px; }
.context-details summary { cursor: pointer; font-weight: 600; }
.context-details dl { display: grid; grid-template-columns: 94px minmax(0, 1fr) 82px minmax(0, 1fr); gap: 4px 8px; margin: 8px 0 0; font-size: 11px; }
.context-details dt { color: #626f86; }.context-details dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.feedback-form:has(.context-details[open]) .writing-surface { height: 156px; }
.error-message { margin: -6px 0 0; color: #ae2a19; font-size: 12px; }
footer { margin: auto -20px 0; min-height: 56px; padding: 10px 20px; border-top: 1px solid #dfe1e6; display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.success-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 32px 64px; gap: 10px; }
.success-state h3,.success-state p { margin: 0; }.success-mark { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: #dffcf0; color: #216e4e; font-size: 24px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-height: 560px) { .feedback-dialog { height: calc(100vh - 16px); } .writing-surface { height: min(240px, 42vh); } .feedback-form { gap: 8px; padding-top: 10px; } }
</style>
