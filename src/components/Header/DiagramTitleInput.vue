<template>
  <div class="group/title inline-flex items-center h-6 min-w-0 px-1.5 gap-0 rounded transition-colors duration-200"
    :class="titleError ? 'bg-[#FEF2F2] border border-[#F87171]' : isFocused ? 'bg-white border border-[#0094D9]' : 'border border-transparent hover:bg-black/[0.05]'">

    <button v-if="aiTitleEnabled || autoNameAnimationDone" type="button"
      class="mr-[5px] h-[18px] w-[18px] rounded p-0.5 flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-[width,margin,color,opacity] duration-200"
      :class="[
        (isGeneratingTitle || showSpark) && !sparkFadingOut ? 'autoname-spark-in text-purple-500' : '',
        sparkFadingOut ? 'autoname-spark-out' : '',
        sparkAlwaysVisible ? 'opacity-100' : 'w-0 mr-0 overflow-hidden opacity-0 group-hover/title:w-[18px] group-hover/title:mr-[5px] group-hover/title:opacity-100 group-focus-within/title:w-[18px] group-focus-within/title:mr-[5px] group-focus-within/title:opacity-100',
      ]"
      title="Generate title with AI" :disabled="isGeneratingTitle || isAnimating" @click="onManualGenerate">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
      </svg>
    </button>

    <input
      ref="inputEl"
      type="text"
      placeholder="Name your diagram…"
      :value="displayValue"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown.enter.prevent="onEnter"
      :readonly="isAnimating"
      :style="{ width: inputWidthPx + 'px' }"
      class="bg-transparent outline-none text-[14px] font-semibold min-w-0"
      :class="[
        isFocused ? 'overflow-x-auto' : 'truncate',
        titleError ? 'text-red-600 placeholder-red-400 placeholder:italic' : 'text-gray-900 placeholder:italic placeholder:text-gray-400',
        isAnimating ? 'autoname-typing' : '',
      ]" />

    <button v-if="showDismiss" type="button" class="autoname-dismiss flex items-center justify-center flex-shrink-0"
      title="Dismiss suggested title" @click="onDismiss">
      <IconDismiss />
    </button>
    <button v-else-if="inputValue" type="button" title="Clear title"
      class="flex items-center justify-center w-4 h-4 flex-shrink-0 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200"
      :class="isFocused ? 'opacity-100' : 'opacity-0 group-hover/title:opacity-100 group-focus-within/title:opacity-100'"
      @click="onClear">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M6 18 18 6M6 6l12 12" />
      </svg>
    </button>

    <!-- Off-screen twin of the input's text, used only to measure its rendered
         width so the field grows with the title instead of sitting in a fixed
         box. Font must match the input exactly or the measurement is wrong. -->
    <span ref="measureEl" aria-hidden="true"
      class="invisible absolute -z-10 whitespace-pre text-[14px] font-semibold">{{ measureText }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import { getCodeFromDiagram } from '@/model/Diagram/DiagramTypeConfig'
import EventBus from '@/EventBus'
import { useAutoTitle } from '@/composables/useAutoTitle'
import IconDismiss from '@/components/icons/IconDismiss.vue'

const AUTO_DEBOUNCE_MS = 1500
const PLACEHOLDER_TEXT = 'Name your diagram…'
// Rest state is bare text with no box, so the field must grow with its
// content instead of sitting in a fixed-width input — capped so a long
// title still leaves room for the tabs and Publish.
const MIN_WIDTH_PX = 72
const MAX_WIDTH_PX = 320
const WIDTH_PADDING_PX = 4

const {
  aiTitleEnabled, isGeneratingTitle, isAnimating, displayedTitle,
  showSpark, sparkFadingOut, showDismiss, autoNameAnimationDone,
  generate, dismiss, markManualEdit, onTitleCleared, reset,
} = useAutoTitle()

const titleError = ref(false)
const isFocused = ref(false)
const draftTitle = ref('')
const measureEl = ref<HTMLSpanElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const inputWidthPx = ref(MIN_WIDTH_PX)

const currentTitle = computed<string>(() => store.state.diagram.title || '')
const diagramType = computed<DiagramType>(() => store.state.diagram.diagramType)
const currentCode = computed<string>(() => getCodeFromDiagram(store.state.diagram, diagramType.value))
const inputValue = computed<string>(() => (isAnimating.value ? displayedTitle.value : currentTitle.value))
const displayValue = computed<string>(() => (isFocused.value ? draftTitle.value : inputValue.value))
const measureText = computed<string>(() => displayValue.value || PLACEHOLDER_TEXT)
// The AI sparkle is a discovery affordance (hover/focus) once a title exists,
// but stays visible without hovering while there's nothing to discover yet
// (empty field) or while it's actively doing something (generating, or a
// fresh suggestion pending dismiss/accept) — same rule the dismiss button
// already follows.
const sparkAlwaysVisible = computed<boolean>(() => !inputValue.value || showSpark.value)

let debounceTimer: ReturnType<typeof setTimeout> | undefined

function scheduleAutoGenerate() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    generate('init', { code: currentCode.value, diagramType: diagramType.value, currentTitle: currentTitle.value })
  }, AUTO_DEBOUNCE_MS)
}

function updateWidth() {
  if (!measureEl.value) return
  const measured = measureEl.value.scrollWidth + WIDTH_PADDING_PX
  inputWidthPx.value = Math.min(MAX_WIDTH_PX, Math.max(MIN_WIDTH_PX, measured))
}

function onFocus() {
  isFocused.value = true
  draftTitle.value = inputValue.value
  nextTick(updateWidth)
}

function onBlur() {
  isFocused.value = false
  store.dispatch('updateTitle', draftTitle.value)
  nextTick(updateWidth)
}

function onEnter() {
  inputEl.value?.blur()
  // Wait until blur has committed the title before moving focus. Otherwise the
  // title field can reclaim focus during the reactive update that blur starts.
  nextTick(() => EventBus.$emit('focus-editor-first-line-end'))
}

function onInput(e: Event) {
  titleError.value = false
  const newVal = (e.target as HTMLInputElement).value
  draftTitle.value = newVal
  if (newVal) {
    markManualEdit()
  } else {
    onTitleCleared()
    scheduleAutoGenerate()
  }
  store.dispatch('updateTitle', newVal)
  nextTick(() => {
    updateWidth()
    const el = inputEl.value
    if (el && isFocused.value) {
      el.scrollLeft = el.scrollWidth
    }
  })
}

function onManualGenerate() {
  generate('user', { code: currentCode.value, diagramType: diagramType.value, currentTitle: currentTitle.value })
}

function onDismiss() {
  dismiss()
}

function onClear() {
  titleError.value = false
  draftTitle.value = ''
  onTitleCleared()
  scheduleAutoGenerate()
  store.dispatch('updateTitle', '')
  nextTick(updateWidth)
}

function onFlashTitleError() {
  titleError.value = true
}

watch(measureText, () => nextTick(updateWidth))
watch(inputValue, (value) => {
  if (!isFocused.value) {
    draftTitle.value = value
  }
})
watch(diagramType, () => { titleError.value = false })
watch(currentCode, () => scheduleAutoGenerate())

onMounted(async () => {
  reset() // clear any per-document state left over from a previous editor session
  draftTitle.value = inputValue.value
  await nextTick()
  updateWidth()
  EventBus.$on('flash-title-error', onFlashTitleError)
  scheduleAutoGenerate()
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
