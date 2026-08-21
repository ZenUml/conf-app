<template>
  <div class="flex items-center flex-none w-[280px] border rounded transition-colors duration-200 h-[26px] px-2 gap-1.5 bg-white"
    :class="titleError ? 'border-red-400 bg-red-50' : 'border-gray-200 focus-within:border-[#0094D9]'">
    <span class="text-[10px] font-semibold tracking-wide text-gray-400 uppercase select-none flex-shrink-0">Title</span>

    <button v-if="aiTitleEnabled || autoNameAnimationDone" type="button"
      class="rounded p-0.5 flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200"
      :class="[
        (isGeneratingTitle || showSpark) && !sparkFadingOut ? 'autoname-spark-in text-purple-500' : '',
        sparkFadingOut ? 'autoname-spark-out' : '',
      ]"
      title="Generate title with AI" :disabled="isGeneratingTitle || isAnimating" @click="onManualGenerate">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
      </svg>
    </button>

    <input
      type="text"
      placeholder="Untitled diagram"
      :value="inputValue"
      @input="onInput"
      :readonly="isAnimating"
      class="flex-1 bg-transparent outline-none text-[13px] min-w-0 truncate"
      :class="[titleError ? 'text-red-700 placeholder-red-300' : 'placeholder:italic placeholder:text-gray-400', isAnimating ? 'autoname-typing' : '']" />

    <button v-if="showDismiss" type="button" class="autoname-dismiss flex items-center justify-center flex-shrink-0"
      title="Dismiss suggested title" @click="onDismiss">
      <IconDismiss />
    </button>
    <button v-else-if="inputValue" type="button" title="Clear title"
      class="flex items-center justify-center w-4 h-4 flex-shrink-0 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200"
      @click="onClear">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M6 18 18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import { getCodeFromDiagram } from '@/model/Diagram/DiagramTypeConfig'
import EventBus from '@/EventBus'
import { useAutoTitle } from '@/composables/useAutoTitle'
import IconDismiss from '@/components/icons/IconDismiss.vue'

const AUTO_DEBOUNCE_MS = 1500

const {
  aiTitleEnabled, isGeneratingTitle, isAnimating, displayedTitle,
  showSpark, sparkFadingOut, showDismiss, autoNameAnimationDone,
  initFlag, generate, dismiss, markManualEdit, onTitleCleared, reset,
} = useAutoTitle()

const titleError = ref(false)

const currentTitle = computed<string>(() => store.state.diagram.title || '')
const diagramType = computed<DiagramType>(() => store.state.diagram.diagramType)
const currentCode = computed<string>(() => getCodeFromDiagram(store.state.diagram, diagramType.value))
const inputValue = computed<string>(() => (isAnimating.value ? displayedTitle.value : currentTitle.value))

let debounceTimer: ReturnType<typeof setTimeout> | undefined

function scheduleAutoGenerate() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    generate('init', { code: currentCode.value, diagramType: diagramType.value, currentTitle: currentTitle.value })
  }, AUTO_DEBOUNCE_MS)
}

function onInput(e: Event) {
  titleError.value = false
  const newVal = (e.target as HTMLInputElement).value
  if (newVal) {
    markManualEdit()
  } else {
    onTitleCleared()
    scheduleAutoGenerate()
  }
  store.dispatch('updateTitle', newVal)
}

function onManualGenerate() {
  generate('user', { code: currentCode.value, diagramType: diagramType.value, currentTitle: currentTitle.value })
}

function onDismiss() {
  dismiss()
}

function onClear() {
  titleError.value = false
  onTitleCleared()
  scheduleAutoGenerate()
  store.dispatch('updateTitle', '')
}

function onFlashTitleError() {
  titleError.value = true
}

watch(currentCode, () => scheduleAutoGenerate())
watch(diagramType, () => { titleError.value = false })

onMounted(async () => {
  reset() // clear any per-document state left over from a previous editor session
  EventBus.$on('flash-title-error', onFlashTitleError)
  await initFlag()
  if (aiTitleEnabled.value) scheduleAutoGenerate()
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  EventBus.$off('flash-title-error', onFlashTitleError)
})
</script>

<style scoped>
@keyframes autoname-spark-fadein { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
@keyframes autoname-spark-fadeout { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.6); } }
/* Gentle twinkle while a title is being generated/typed, so the spark reads as "working". */
@keyframes autoname-spark-pulse { 0%, 100% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.2); opacity: 1; } }
/* Fade in once, then pulse continuously until the spark fades out in Phase 3. */
.autoname-spark-in { animation: autoname-spark-fadein 300ms ease-out, autoname-spark-pulse 1.1s ease-in-out 300ms infinite; }
.autoname-spark-out { animation: autoname-spark-fadeout 400ms ease-in forwards; }

@keyframes autoname-blink { 0%, 100% { border-right-color: #7C3AED; } 50% { border-right-color: transparent; } }
.autoname-typing { border-right: 2px solid #7C3AED; animation: autoname-blink 0.8s step-end infinite; }

.autoname-dismiss { width: 22px; height: 22px; border-radius: 4px; background: transparent; color: #42526E; }
.autoname-dismiss:hover { background: #EBECF0; color: #172B4D; }
</style>
