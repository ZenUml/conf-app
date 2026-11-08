<template>
  <main class="title-draft" aria-label="Diagram preview">
    <p class="title-draft__source">Based on the page title</p>
    <!-- Mermaid output under securityLevel strict, the same path the viewer renders. -->
    <div class="title-draft__preview" data-testid="title-draft-preview" v-html="svg" />
    <footer class="title-draft__footer">
      <p v-if="error" class="title-draft__error" role="alert">{{ error }}</p>
      <p v-else class="title-draft__note">Adds to the top of the page. You can edit it or move it anywhere.</p>
      <button
        type="button"
        class="title-draft__add"
        data-testid="title-draft-add"
        :disabled="busy || !svg"
        @click="add"
      >
        Add to page
      </button>
    </footer>
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { renderMermaid } from '@/utils/mermaid/renderMermaid'
import type { TitleDraftClosePayload } from './constants'
import type { AddDraftResult } from './addDraft'

/**
 * Body of the Forge `xlarge` modal. Confluence draws the title and the X; this
 * previews and adds only, because editing belongs to the real editor afterwards.
 */
const props = defineProps<{
  mermaid: string
  add: () => Promise<AddDraftResult>
  onClose: (payload: TitleDraftClosePayload) => void
}>()

const svg = ref('')
const busy = ref(false)
const error = ref('')

const NOT_ADDED = 'The diagram was not added. Try again.'
const MESSAGES: Partial<Record<AddDraftResult['result'], string>> = {
  forbidden: 'You need permission to edit this page to add a diagram.',
  conflict: NOT_ADDED,
  save_failed: NOT_ADDED,
  failed: NOT_ADDED,
}

async function add() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const outcome = await props.add()
    if (outcome.result === 'added') return props.onClose({ outcome: 'added', contentId: outcome.contentId })
    if (outcome.result === 'already_added') return props.onClose({ outcome: 'already_added' })
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
  if (event.key === 'Escape') props.onClose({ outcome: 'dismissed' })
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  try {
    const result = await renderMermaid(`title-draft-${Date.now()}`, props.mermaid)
    svg.value = result.svg
  } catch (e) {
    console.error('[title-draft] preview failed', e)
    props.onClose({ outcome: 'dismissed' })
  }
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.title-draft {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100vh;
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
.title-draft__add {
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
.title-draft__add:hover:not(:disabled) { background: var(--ds-background-brand-bold-hovered, #1558bc); }
.title-draft__add:disabled { opacity: 0.6; cursor: not-allowed; }
.title-draft__add:focus-visible { outline: 2px solid var(--ds-border-focused, #4688ec); outline-offset: 2px; }
</style>
