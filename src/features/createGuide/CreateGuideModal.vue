<template>
  <main class="create-guide" :aria-label="description">
    <video
      class="create-guide__video"
      :src="videoSrc"
      :autoplay="!reducedMotion"
      muted
      loop
      playsinline
      preload="auto"
      disablepictureinpicture
      aria-hidden="true"
    />
    <button type="button" class="create-guide__close" aria-label="Close guide" title="Close guide" @click="close('button')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { CreateGuideVariant } from '@/utils/analytics/catalog'
import type { CreateGuideClosePayload } from './openCreateGuide'

/**
 * Content of the untitled Forge medium modal (600 × 520) opened by the viewer's Create button.
 * The modal has no Atlassian header or close control, and Confluence's Escape stops working once
 * focus is inside this iframe (measured on lite-stg, 2026-10-02), so the guide closes itself.
 * Videos are 1200 × 1040 renders of the Remotion guide project (docs/features/create-guide.md).
 */
const props = defineProps<{
  variant: CreateGuideVariant
  onClose: (payload: CreateGuideClosePayload) => void
}>()

const QUERY: Record<CreateGuideVariant, string> = { zenuml: 'zenuml', graph: 'graph', api: 'openapi' }
/** Frame showing the typed query with the target macro highlighted — the reduced-motion still. */
const STILL_SECONDS = 5

const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const videoSrc = computed(() => {
  // Relative and bound: Vite builds with base './', and public/ files must not become imports.
  const src = `./video/create-guide-${props.variant}.mp4`
  return reducedMotion ? `${src}#t=${STILL_SECONDS}` : src
})
const description = computed(() =>
  `How to add a diagram: edit the page, click where it should go, type /${QUERY[props.variant]} and pick the macro.`)

function close(method: CreateGuideClosePayload['method']) {
  props.onClose({ method })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  close('escape')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style>
html:has(.create-guide), html:has(.create-guide) body { margin: 0; height: 100%; overflow: hidden; background: #fff; }
.create-guide { position: fixed; inset: 0; overflow: hidden; background: #fff; }
.create-guide__video { display: block; width: 100%; height: 100%; object-fit: contain; }
.create-guide__close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid #B7C2D0;
  border-radius: 50%;
  background: rgb(255 255 255 / 96%);
  color: #172B4D;
  box-shadow: 0 2px 8px rgb(9 30 66 / 22%);
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
}
.create-guide__close svg { width: 16px; height: 16px; }
.create-guide__close:hover { background: #fff; border-color: #7A869A; }
/* :focus rather than :focus-visible: a click closes the guide, so focus only arrives from Tab. */
.create-guide:hover .create-guide__close,
.create-guide__close:focus { opacity: 1; }
.create-guide__close:focus-visible { outline: 2px solid #0052CC; outline-offset: 2px; }
/* Touch screens have no hover. */
@media (hover: none) { .create-guide__close { opacity: 1; } }
</style>
