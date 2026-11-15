<template>
  <main class="title-draft" aria-label="Diagram preview">
    <p class="title-draft__source">Based on the page title</p>
    <p v-if="previewState === 'loading' && !previewFailure" class="title-draft__loading" role="status">Preparing your diagram…</p>
    <!-- Mermaid output under securityLevel strict, the same path the viewer renders. -->
    <div class="title-draft__preview" data-testid="title-draft-preview" v-html="svg" />
    <footer class="title-draft__footer">
      <p v-if="previewFailure" class="title-draft__error" role="alert">{{ previewFailure === 'timeout' ? 'This preview is taking too long. Reload the preview to try again.' : 'This preview could not be prepared. Reload the preview to try again.' }}</p>
      <p v-else-if="error" class="title-draft__error" role="alert">{{ error }}</p>
      <p v-else class="title-draft__note">Adds to the top of the page. You can edit it or move it anywhere.</p>
      <button v-if="previewFailure" type="button" class="title-draft__reload" data-testid="title-draft-reload" :disabled="reloading" @click="reloadPreview">Reload preview</button>
      <button
        type="button"
        class="title-draft__add"
        data-testid="title-draft-add"
        :disabled="busy || previewState !== 'ready'"
        @click="addToPage"
      >
        Add to page
      </button>
    </footer>
  </main>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { renderMermaid } from '@/utils/mermaid/renderMermaid'
import type { TitleDraftClosePayload } from './constants'
import type { AddDraftResult } from './addDraft'
import type { TitleDraftPreviewRenderFailure } from '@/utils/analytics/catalog'
import { reloadTitleDraftPreview } from './previewReload'

/**
 * Body of the Forge `xlarge` modal. Confluence draws the title and the X; this
 * previews and adds only, because editing belongs to the real editor afterwards.
 */
const props = defineProps<{
  mermaid: string
  add: () => Promise<AddDraftResult>
  onClose: (payload: TitleDraftClosePayload) => void
  onPreviewMounted?: () => void
  onPreviewRendered?: (renderMs: number) => void
  onPreviewRenderDelayed?: (renderMs: number) => void
  onPreviewRenderFailed?: (reason: TitleDraftPreviewRenderFailure, renderMs: number) => Promise<void>
  onPreviewReload?: (reason: TitleDraftPreviewRenderFailure) => Promise<void>
  onAddClicked?: () => void
}>()

const svg = ref('')
const busy = ref(false)
const error = ref('')
const previewState = ref<'loading' | 'ready' | 'failed'>('loading')
const previewFailure = ref<TitleDraftPreviewRenderFailure | null>(null)
const reloading = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | undefined
let renderStartedAt = 0
let active = true
let closed = false

function clearPreviewTimer() {
  if (previewTimer !== undefined) clearTimeout(previewTimer)
  previewTimer = undefined
}

// Observability must never prevent rendering, recovery, or saving.
function notify(callback: () => unknown) {
  try { Promise.resolve(callback()).catch(() => {}) } catch { /* Best-effort telemetry. */ }
}

function close(payload: TitleDraftClosePayload) {
  if (!active || closed) return
  closed = true
  clearPreviewTimer()
  notify(() => props.onClose(payload))
}

function failPreview(reason: TitleDraftPreviewRenderFailure) {
  if (!active || closed || reloading.value || previewState.value !== 'loading') return
  clearPreviewTimer()
  previewState.value = 'failed'
  previewFailure.value = reason
  notify(() => props.onPreviewRenderFailed?.(reason, Math.max(0, Date.now() - renderStartedAt)))
}

function showDelayedPreview() {
  if (!active || closed || reloading.value || previewState.value !== 'loading') return
  clearPreviewTimer()
  previewFailure.value = 'timeout'
  notify(() => props.onPreviewRenderDelayed?.(Math.max(0, Date.now() - renderStartedAt)))
}

async function reloadPreview() {
  if (!active || closed || !previewFailure.value || reloading.value) return
  reloading.value = true
  try { await props.onPreviewReload?.(previewFailure.value) } catch { /* Reload even if telemetry fails. */ }
  if (active && !closed) reloadTitleDraftPreview()
}

const NOT_ADDED = 'The diagram was not added. Try again.'
const MESSAGES: Partial<Record<AddDraftResult['result'], string>> = {
  forbidden: 'You need permission to edit this page to add a diagram.',
  conflict: NOT_ADDED,
  save_failed: NOT_ADDED,
  failed: NOT_ADDED,
}

async function addToPage() {
  if (!active || busy.value || closed || previewState.value !== 'ready') return
  busy.value = true
  notify(() => props.onAddClicked?.())
  error.value = ''
  try {
    const outcome = await props.add()
    if (!active || closed) return
    if (outcome.result === 'added') return close({ outcome: 'added', contentId: outcome.contentId })
    if (outcome.result === 'already_added') return close({ outcome: 'already_added' })
    error.value = MESSAGES[outcome.result] ?? NOT_ADDED
  } catch (e) {
    console.error('[title-draft] add failed', e)
    error.value = NOT_ADDED
  } finally {
    busy.value = false
  }
}

// Focus inside a Forge iframe stops Confluence's own Escape handling.
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close({ outcome: 'dismissed', reason: 'escape' })
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  renderStartedAt = Date.now()
  previewTimer = setTimeout(showDelayedPreview, 10_000)
  notify(() => props.onPreviewMounted?.())
  try {
    const result = await renderMermaid(`title-draft-${Date.now()}`, props.mermaid)
    if (!active || closed || reloading.value || previewState.value !== 'loading') return
    if (!result.svg?.trim()) return failPreview('empty_svg')
    clearPreviewTimer()
    previewState.value = 'ready'
    previewFailure.value = null
    svg.value = result.svg
  } catch (e) {
    failPreview('render_error')
    return
  }
  // The event describes visible output, so wait for Vue's v-html DOM update.
  await nextTick()
  if (active && !closed && !reloading.value) notify(() => props.onPreviewRendered?.(Math.max(0, Date.now() - renderStartedAt)))
})

onBeforeUnmount(() => {
  active = false
  clearPreviewTimer()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.title-draft {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  /* Forge sizes this iframe to the whole dialog and draws it below the title bar,
     so its last 11px fall past the bottom of the viewport. */
  height: calc(100vh - 11px);
  padding: 2px 24px 24px;
  font-family: "Atlassian Sans", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif;
  color: var(--ds-text, #292a2e);
}
.title-draft__source {
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 20px;
  color: var(--ds-text-subtle, #505258);
}
.title-draft__loading {
  margin: 0;
  color: var(--ds-text-subtle, #505258);
  font-size: 14px;
}
.title-draft__preview {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}
.title-draft__preview :deep(svg) {
  max-width: 100%;
  max-height: 100%;
}
.title-draft__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.title-draft__note,
.title-draft__error {
  margin: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--ds-text-subtle, #505258);
}
.title-draft__error { color: var(--ds-text-danger, #ae2e24); }
.title-draft__add,
.title-draft__reload {
  flex-shrink: 0;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: var(--ds-background-brand-bold, #1868db);
  color: var(--ds-text-inverse, #ffffff);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
}
.title-draft__reload {
  background: var(--ds-background-neutral, #f1f2f4);
  color: var(--ds-text, #292a2e);
}
.title-draft__add:hover:not(:disabled) { background: var(--ds-background-brand-bold-hovered, #1558bc); }
.title-draft__add:disabled,
.title-draft__reload:disabled { opacity: 0.6; cursor: not-allowed; }
.title-draft__add:focus-visible,
.title-draft__reload:focus-visible { outline: 2px solid var(--ds-border-focused, #4688ec); outline-offset: 2px; }
</style>
