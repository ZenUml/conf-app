<template>
  <div ref="root" class="viewer-create-story" :class="`viewer-create-story--${kind}`">
    <template v-if="kind === 'graph'">
      <ForgeGraphViewer v-if="graphReady" :graph-xml="graphXml" />
    </template>
    <OpenApiViewer v-else-if="kind === 'openapi'" :doc="{ code: openApiSpec }" />
    <GenericViewer v-else :wide="true">
      <Mermaid />
    </GenericViewer>

    <!-- This button lives in the real GenericViewer action row. No production
         component markup or action behavior is changed by the design story. -->
    <Teleport v-if="actionsTarget" :to="actionsTarget">
      <button
        ref="createButton"
        type="button"
        class="viewer-create-discovery-button"
        aria-haspopup="dialog"
        :aria-expanded="guideOpen"
        @click="openGuide"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Create
      </button>
    </Teleport>

    <!-- Stand-in for the modal Confluence draws for
         openModal({ resource: 'main', size: 'medium', title: '', context: { macroMode: 'create-guide' } }).
         Measured on lite-stg 2026-10-02 (1280 × 800): 600 × 520 box, 60px from the top, radius 12,
         no header when the title is empty, focus starts on the dialog element. Everything inside is
         our own content: the guide page, which carries its own close button and Escape handler. -->
    <Teleport to="body">
      <div v-if="guideOpen" class="forge-modal-stub-blanket" data-testid="custom-ui-modal-dialog--blanket" @pointerdown.self="closeGuide">
        <section
          ref="dialogElement"
          class="forge-modal-stub"
          role="dialog"
          aria-modal="true"
          aria-label="Add a diagram with a slash command"
          data-testid="custom-ui-modal-dialog"
          tabindex="-1"
        >
          <iframe
            ref="guideFrame"
            :src="guideUrl"
            :title="`${guideLabel} creation guide`"
            loading="eager"
          />
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import GenericViewer from '../GenericViewer.vue'
import ForgeGraphViewer from '../ForgeGraphViewer.vue'
import OpenApiViewer from '../OpenApiViewer.vue'
import Mermaid from '@/components/Mermaid.vue'
import { ensureDrawioViewerLoaded } from '@/utils/drawio/loadDrawioViewer'

type ViewerKind = 'mermaid' | 'graph' | 'openapi'

const props = withDefaults(defineProps<{
  kind?: ViewerKind
  graphXml?: string
  openApiSpec?: string
}>(), {
  kind: 'mermaid',
  graphXml: '',
  openApiSpec: '',
})

/** Local Remotion review server (zenuml-creation-guide, `npm run dev`); `embed=1` is the modal content. */
const GUIDE_ORIGIN = 'http://127.0.0.1:5173'
const GUIDES: Record<ViewerKind, { id: string; label: string }> = {
  mermaid: { id: 'zenuml', label: 'ZenUML' },
  graph: { id: 'graph', label: 'Graph' },
  openapi: { id: 'api', label: 'OpenAPI' },
}
/** What the guide page posts in place of `view.close()`. */
const CLOSE_MESSAGE = { source: 'zenuml-creation-guide', type: 'close' }

const root = ref<HTMLElement | null>(null)
const actionsTarget = ref<HTMLElement | null>(null)
const createButton = ref<HTMLButtonElement | null>(null)
const dialogElement = ref<HTMLElement | null>(null)
const guideFrame = ref<HTMLIFrameElement | null>(null)
const graphReady = ref(false)
const guideOpen = ref(false)
const guideLabel = computed(() => GUIDES[props.kind].label)
const guideUrl = computed(() => `${GUIDE_ORIGIN}/?guide=${GUIDES[props.kind].id}&embed=1`)
let observer: MutationObserver | undefined

function findActions() {
  const actions = root.value?.querySelector<HTMLElement>('.viewer-top-actions')
  if (actions) {
    // Production's Edit button only has a tooltip when disabled. The compact
    // story keeps its existing accessible name and adds the matching tooltip.
    const edit = actions.querySelector<HTMLButtonElement>('button[aria-label="Edit"]')
    if (edit && !edit.title) edit.title = 'Edit diagram'
    actionsTarget.value = actions
    observer?.disconnect()
  }
}

/** Production: forgeGlobal.openModal({ resource: 'main', size: 'medium', title: '', context: { macroMode: 'create-guide', guide } }). */
function openGuide() {
  guideOpen.value = true
  nextTick(() => dialogElement.value?.focus())
}

function closeGuide() {
  guideOpen.value = false
  nextTick(() => createButton.value?.focus())
}

/** Confluence's closeOnEscape: only reaches us while focus is outside the guide iframe. */
function onWindowKeydown(event: KeyboardEvent) {
  if (guideOpen.value && event.key === 'Escape') {
    event.preventDefault()
    closeGuide()
  }
}

/** The guide's own close button / Escape — the stub's stand-in for `view.close()`. */
function onWindowMessage(event: MessageEvent) {
  if (!guideOpen.value || event.source !== guideFrame.value?.contentWindow) return
  if (event.data?.source === CLOSE_MESSAGE.source && event.data?.type === CLOSE_MESSAGE.type) closeGuide()
}

onMounted(async () => {
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('message', onWindowMessage)
  findActions()
  if (!actionsTarget.value && root.value) {
    observer = new MutationObserver(findActions)
    observer.observe(root.value, { childList: true, subtree: true })
  }
  if (props.kind === 'graph') {
    await ensureDrawioViewerLoaded()
    graphReady.value = true
    await nextTick()
    findActions()
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('message', onWindowMessage)
})
</script>

<style>
.viewer-create-story { width: 100%; container-type: inline-size; font-family: Arial, sans-serif; }
.viewer-create-story .viewer-frame { width: 100%; }
.viewer-create-story .viewer-edge-top { min-height: 47px; border-bottom-color: #E5E7EB; }
.viewer-create-story .viewer-top-actions { opacity: 1; flex-shrink: 0; }
.viewer-create-story .viewer-title { max-width: none; }
.viewer-create-story .viewer-canvas { min-height: 240px; }
.viewer-create-story--mermaid .viewer-canvas .screen-capture-content {
  min-height: 240px;
  display: grid;
  align-items: center;
}
.viewer-create-story--mermaid .mermaid-root { width: 100%; }
.viewer-create-story--graph .graph-viewport,
.viewer-create-story--graph .graph-viewer-canvas { min-height: 240px; }
.viewer-create-story .viewer-top-actions > .viewer-btn-ghost[aria-label="Edit"],
.viewer-create-story .viewer-top-actions > .viewer-btn-ghost[aria-label="Source"] {
  width: 30px;
  height: 30px;
  padding: 6px;
  justify-content: center;
}
.viewer-create-story .viewer-top-actions > .viewer-btn-ghost[aria-label="Edit"] > span,
.viewer-create-story .viewer-top-actions > .viewer-btn-ghost[aria-label="Source"] > span { display: none; }
.viewer-create-story .viewer-top-actions > .viewer-btn-ghost[aria-label="Edit"] { order: 1; }
.viewer-create-story .viewer-top-actions > .viewer-btn-ghost[aria-label="Source"] { order: 2; }
.viewer-create-story .viewer-top-actions > .copy-for-ai-split { order: 3; }
.viewer-create-story .viewer-top-actions > .viewer-btn-primary { order: 4; }
.viewer-create-discovery-button {
  order: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid #B3D4FF;
  border-radius: 6px;
  background: #F0F6FF;
  color: #0052CC;
  font: 600 13px/1 Arial, sans-serif;
  white-space: nowrap;
  cursor: pointer;
}
.viewer-create-discovery-button:hover { background: #DEEBFF; border-color: #85B8FF; }
.viewer-create-discovery-button:focus-visible { outline: 2px solid #0052CC; outline-offset: 2px; }
.viewer-create-discovery-button svg { width: 15px; height: 15px; }

@container (max-width: 640px) {
  .viewer-create-story .viewer-edge-top { flex-wrap: wrap; align-items: stretch; gap: 5px; padding-block: 8px; }
  .viewer-create-story .viewer-title-area { width: 100%; margin-right: 0; }
  .viewer-create-story .viewer-top-actions { width: 100%; justify-content: flex-start; flex-wrap: wrap; }
}
@container (max-width: 430px) {
  .viewer-create-story .viewer-canvas,
  .viewer-create-story--mermaid .viewer-canvas .screen-capture-content,
  .viewer-create-story--graph .graph-viewport,
  .viewer-create-story--graph .graph-viewer-canvas { min-height: 180px; }
  .viewer-create-story .viewer-top-actions { gap: 4px; }
  .viewer-create-story .copy-for-ai-label-stack .copy-for-ai-label-cell > span { display: none; }
  .viewer-create-story .copy-for-ai-split-primary { width: 30px; min-width: 30px; padding: 6px; justify-content: center; }
  .viewer-create-story .viewer-btn-primary { padding-inline: 8px; }
}

/* Forge medium modal stand-in. 600 × 520 matches the guide composition (1200 × 1040 in contract.ts).
   How Confluence sizes a medium modal in a narrow window was not measured; the stub keeps the box
   inside the viewport at the same ratio. */
.forge-modal-stub-blanket {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 60px 16px 16px;
  box-sizing: border-box;
  overflow: hidden;
  background: rgb(9 30 66 / 54%);
}
.forge-modal-stub {
  position: relative;
  width: min(600px, calc(100vw - 32px), calc((100dvh - 76px) * 600 / 520));
  aspect-ratio: 600 / 520;
  overflow: hidden;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 12px rgb(9 30 66 / 15%), 0 0 1px rgb(9 30 66 / 31%);
}
/* Confluence shows this ring while its dialog element holds focus (seen on lite-stg). */
.forge-modal-stub:focus { outline: 2px solid #4C9AFF; outline-offset: 0; }
.forge-modal-stub iframe { position: absolute; inset: 0; display: block; width: 100%; height: 100%; border: 0; }
</style>
