<template>
  <div class="flex items-center flex-1 min-w-64 border-2 rounded-md transition-colors duration-200 h-10"
    :class="titleError ? 'border-red-400 bg-red-50' : 'border-gray-200 hover:border-gray-300 focus-within:border-blue-500'">
    <span class="pl-3 pr-2 text-xs font-semibold tracking-wide text-gray-400 uppercase select-none flex-shrink-0">Title</span>
    <div class="w-px h-4 bg-gray-200 flex-shrink-0"></div>

    <span v-if="showSpark" class="pl-2 flex items-center" :class="sparkFadingOut ? 'autoname-spark-out' : 'autoname-spark-in'">
      <IconSpark />
    </span>

    <input
      type="text"
      placeholder="Name your diagram…"
      :value="inputValue"
      @input="onInput"
      :readonly="isAnimating"
      class="flex-1 px-2 py-2 bg-transparent outline-none text-sm min-w-0"
      :class="[titleError ? 'text-red-700 placeholder-red-300' : '', isAnimating ? 'autoname-typing' : '']" />

    <button v-if="showDismiss" type="button" class="autoname-dismiss flex items-center justify-center flex-shrink-0"
      title="Dismiss suggested title" @click="onDismiss">
      <IconDismiss />
    </button>

    <div v-if="aiTitleEnabled" class="pr-1 flex items-center flex-shrink-0">
      <button class="rounded-md p-1 text-gray-600 hover:bg-gray-200 transition-colors duration-200"
        :class="{ 'pointer-events-none opacity-50 cursor-not-allowed': isGeneratingTitle }"
        title="Generate title with AI" :disabled="isGeneratingTitle" @click="onManualGenerate">
        <SparklesIcon v-if="!isGeneratingTitle" class="w-5 h-5" />
        <ArrowPathIcon v-else class="w-5 h-5 animate-spin" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import { getCodeFromDiagram } from '@/model/Diagram/DiagramTypeConfig'
import EventBus from '@/EventBus'
import { useAutoTitle } from '@/composables/useAutoTitle'
import IconSpark from '@/components/icons/IconSpark.vue'
import IconDismiss from '@/components/icons/IconDismiss.vue'
import SparklesIcon from '@heroicons/vue/24/outline/SparklesIcon'
import ArrowPathIcon from '@heroicons/vue/24/outline/ArrowPathIcon'

const AUTO_DEBOUNCE_MS = 1500

const {
  aiTitleEnabled, isGeneratingTitle, isAnimating, displayedTitle,
  showSpark, sparkFadingOut, showDismiss,
  initFlag, generate, dismiss, markManualEdit, reset,
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
  markManualEdit()
  store.dispatch('updateTitle', (e.target as HTMLInputElement).value)
}

function onManualGenerate() {
  generate('user', { code: currentCode.value, diagramType: diagramType.value, currentTitle: currentTitle.value })
}

function onDismiss() {
  dismiss()
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
