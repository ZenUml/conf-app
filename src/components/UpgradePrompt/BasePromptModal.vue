<template>
  <Teleport to="body">
    <div
      ref="modalContainer"
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      tabindex="-1"
      @keydown.esc="$emit('close')"
    >
      <div class="fixed inset-0 bg-black bg-opacity-50" @click="$emit('close')"></div>
      <div :class="['relative bg-white rounded-lg shadow-xl', widthClass, 'max-h-[660px] overflow-y-auto']">
        <header class="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 class="text-base font-semibold text-gray-900">
            <slot name="title" />
          </h2>
          <button
            class="text-gray-400 hover:text-gray-600 text-xl leading-none cursor-pointer"
            aria-label="Close"
            @click="$emit('close')"
          >×</button>
        </header>
        <div class="p-4">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="px-4 py-2 bg-gray-50 border-t border-gray-200">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'

const props = withDefaults(defineProps<{
  visible: boolean
  widthClass?: string
}>(), {
  widthClass: 'w-[480px]',
})

defineEmits<{ (e: 'close'): void }>()

const modalContainer = ref<HTMLElement | null>(null)
watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    modalContainer.value?.focus()
  }
})
</script>
