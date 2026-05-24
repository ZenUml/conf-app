<template>
  <!-- Compact overlay anchored on DrawIO's menubar row, right-aligned.
       Save & Exit / fullscreen / sidebar buttons sit on row 2 below, so
       the menubar row's right side is empty — title can hug the edge. -->
  <div class="absolute top-[1px] right-[12px] z-50 pointer-events-auto">
    <div class="flex items-center w-72 max-w-md border rounded-md transition-colors duration-200 h-7 bg-white"
      :class="error ? 'border-red-400 bg-red-50' : 'border-gray-300 hover:border-gray-400 focus-within:border-blue-500'">
      <span class="pl-3 pr-2 text-[10px] font-semibold tracking-wide text-gray-400 uppercase select-none flex-shrink-0">Title</span>
      <div class="w-px h-3 bg-gray-200 flex-shrink-0"></div>
      <input
        type="text"
        placeholder="Name your graph…"
        :value="title"
        @input="handleInput"
        @keydown.enter="$emit('titleConfirm')"
        ref="inputRef"
        class="flex-1 px-2 py-0 bg-transparent outline-none text-xs min-w-0"
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
