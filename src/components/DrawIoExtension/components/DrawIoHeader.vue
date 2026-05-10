<template>
  <!-- Compact overlay anchored at top-right of the iframe, on DrawIO's
       toolbar row (matching the official drawio Confluence plugin's
       filename placement). The right offset clears DrawIO's Save & Exit
       button. -->
  <div class="absolute top-1 right-[140px] z-50 flex items-center pointer-events-auto">
    <div class="flex items-center w-72 max-w-md border-2 rounded-md transition-colors duration-200 h-8 bg-white"
      :class="error ? 'border-red-400 bg-red-50' : 'border-gray-200 hover:border-gray-300 focus-within:border-blue-500'">
      <span class="pl-3 pr-2 text-xs font-semibold tracking-wide text-gray-400 uppercase select-none flex-shrink-0">Title</span>
      <div class="w-px h-4 bg-gray-200 flex-shrink-0"></div>
      <input
        type="text"
        placeholder="Name your graph…"
        :value="title"
        @input="handleInput"
        @keydown.enter="$emit('titleConfirm')"
        ref="inputRef"
        class="flex-1 px-2 py-1 bg-transparent outline-none text-sm min-w-0"
        :class="error ? 'text-red-700 placeholder-red-300' : ''" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";

export default defineComponent({
  props: {
    title: {
      type: String,
      default: "",
    },
    error: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["titleChange", "titleConfirm"],
  setup(_, { emit }) {
    const inputRef = ref<HTMLInputElement>();

    const handleInput = (event: Event) => {
      const value = (event.target as HTMLInputElement).value;
      emit("titleChange", value);
    };

    const focusInput = () => {
      inputRef.value?.focus();
    };

    return {
      inputRef,
      handleInput,
      focusInput,
    };
  },
});
</script>

<style scoped></style>
