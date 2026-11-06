<template>
  <div class="px-4 pb-3.5 flex flex-col gap-2">
    <template v-if="state === 'failed'">
      <div class="bg-red-50 border border-red-100 rounded-md p-3 flex flex-col gap-2">
        <div class="flex items-start gap-2 text-red-700 text-xs leading-[1.45]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 mt-0.5">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          </svg>
          <span>Couldn't copy. Select the draft above and copy manually (⌘/Ctrl+C).</span>
        </div>
        <textarea
          ref="fallbackTextareaRef"
          :value="message"
          readonly
          data-testid="advocacy-fallback-textarea"
          class="w-full h-32 text-[12px] font-mono text-gray-800 bg-white border border-gray-200 rounded p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          @focus="onFallbackFocus"
        ></textarea>
        <button
          type="button"
          class="self-start text-xs text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
          @click="onCopy"
        >Try again</button>
      </div>
    </template>
    <button
      v-else
      type="button"
      data-testid="advocacy-copy-btn"
      :class="[
        'w-full font-semibold text-sm rounded-md px-4 py-3 flex items-center justify-center gap-2 transition-colors text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
        state === 'copied'
          ? 'bg-green-600 hover:bg-green-700'
          : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
      ]"
      @click="onCopy"
    >
      <template v-if="state === 'copied'">
        <svg :class="feedbackFadeClass" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m5 12 5 5L20 7" />
        </svg>
        <span :class="feedbackFadeClass">Copied — paste into Slack or email</span>
      </template>
      <template v-else>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
        <span>Copy upgrade request</span>
      </template>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import { useTransientFlag } from '../../composables/useTransientFlag'

const props = defineProps<{
  message: string
}>()

const emit = defineEmits<{
  (e: 'copied'): void
}>()

type State = 'default' | 'copied' | 'failed'
const state = ref<State>('default')
const fallbackTextareaRef = ref<HTMLTextAreaElement | null>(null)

// Holds the "Copied" state for 2.5 s, then fades the label out before it reverts.
const copiedFlag = useTransientFlag()
watch(copiedFlag.active, (active) => {
  if (!active && state.value === 'copied') state.value = 'default'
})
const feedbackFadeClass = computed(() => [
  'transition-opacity duration-300 ease-out',
  copiedFlag.fading.value ? 'opacity-0' : 'opacity-100',
])

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to execCommand fallback
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.style.left = '-9999px'
    textarea.setAttribute('readonly', '')
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

async function onCopy() {
  const ok = await copyText(props.message)
  if (ok) {
    state.value = 'copied'
    emit('copied')
    copiedFlag.trigger()
  } else {
    copiedFlag.reset()
    state.value = 'failed'
    await nextTick()
    fallbackTextareaRef.value?.focus()
    fallbackTextareaRef.value?.select()
  }
}

function onFallbackFocus(event: FocusEvent) {
  ;(event.target as HTMLTextAreaElement).select()
}
</script>
