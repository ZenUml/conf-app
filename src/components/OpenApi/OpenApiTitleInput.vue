<template>
  <div class="flex flex-col flex-1 min-w-0 max-w-2xl mr-2">
    <div
      class="group/openapi-title flex items-center w-full px-1 border-2 border-solid border-[#091e4224] rounded-[3px] focus-within:border-[#388bff] hover:border-[#388bff] transition-[border-color]"
    >
      <button
        v-if="aiTitleEnabled || autoNameAnimationDone"
        type="button"
        :class="[
          'openapi-autoname-spark rounded p-0.5 mr-1 flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200',
          (isGeneratingTitle || showSpark) && !sparkFadingOut
            ? 'openapi-autoname-spark-in text-purple-500'
            : '',
          sparkFadingOut ? 'openapi-autoname-spark-out' : '',
        ]"
        title="Generate title with AI"
        :disabled="isGeneratingTitle || isAnimating"
        @click="handleManualGenerate"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path
            d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
          />
        </svg>
      </button>

      <input
        :class="[
          'flex-1 min-w-0 bg-transparent outline-none leading-7',
          isAnimating ? 'openapi-autoname-typing' : '',
        ]"
        type="text"
        placeholder="Title"
        :value="displayTitle"
        :readonly="isAnimating"
        @input="handleInput"
      />

      <button
        v-if="showDismiss"
        type="button"
        class="openapi-autoname-dismiss flex items-center justify-center flex-shrink-0"
        title="Dismiss suggested title"
        @click="handleDismiss"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div v-if="parseError" class="text-red-500 text-xs mt-1">
      Note: YAML parsing error detected. Title changes may not be saved to the specification.
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { DiagramType } from '@/model/Diagram/Diagram'
import store from '@/model/store2'
import { useAutoTitle } from '@/composables/useAutoTitle'
import { buildOpenApiAiTitleContent } from '@/model/OpenApi/OpenApiEditorState'

const AUTO_DEBOUNCE_MS = 1500

const props = defineProps<{
  title: string
  spec: string
  parseError: Error | null
  onTitleChange?: (title: string) => void
}>()

const emit = defineEmits<{
  (e: 'title-change', title: string): void
}>()

const autoTitle = useAutoTitle()
const {
  aiTitleEnabled,
  isGeneratingTitle,
  isAnimating,
  displayedTitle,
  showSpark,
  sparkFadingOut,
  showDismiss,
  autoNameAnimationDone,
} = autoTitle

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let generatedTitleSynced = false

function notifyTitleChange(nextTitle: string) {
  props.onTitleChange?.(nextTitle)
  emit('title-change', nextTitle)
}

function scheduleAutoGenerate() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void autoTitle.generate('init', {
      code: buildOpenApiAiTitleContent(props.spec),
      diagramType: DiagramType.OpenApi,
      currentTitle: props.title,
    })
  }, AUTO_DEBOUNCE_MS)
}

watch(
  autoNameAnimationDone,
  (done) => {
    if (done && !generatedTitleSynced) {
      generatedTitleSynced = true
      notifyTitleChange(store.state.diagram.title || '')
    } else if (!done) {
      generatedTitleSynced = false
    }
  },
  { flush: 'sync' },
)

watch(
  () => props.spec,
  () => {
    scheduleAutoGenerate()
  },
)

onMounted(() => {
  autoTitle.reset()
  scheduleAutoGenerate()
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  autoTitle.reset()
})

function handleInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (value) {
    autoTitle.markManualEdit()
  } else {
    autoTitle.onTitleCleared()
    scheduleAutoGenerate()
  }
  notifyTitleChange(value)
}

function handleManualGenerate() {
  void autoTitle.generate('user', {
    code: buildOpenApiAiTitleContent(props.spec),
    diagramType: DiagramType.OpenApi,
    currentTitle: props.title,
  })
}

function handleDismiss() {
  autoTitle.dismiss()
  notifyTitleChange('')
}

const displayTitle = computed(() => (isAnimating.value ? displayedTitle.value : props.title))
</script>
