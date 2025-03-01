<template>
  <transition name="fade">
    <div
      v-if="open"
      class="fixed w-[300px] h-fit bottom-4 right-4 z-50 bg-white text-[#282828] py-4 px-6 rounded-xl drop-shadow-[0_20px_26px_rgba(176,176,176,0.35)]"
    >
      <div v-if="!hasFeedback">
        <p class="font-bold text-sm mb-3">
          How was the AI-generated diagram?
        </p>
        <div class="flex gap-2">
          <button
            v-for="option in options"
            :key="option.value"
            @click="handleOptionSelect(option.value)"
            class="flex-1 text-xs p-2 border rounded-lg hover:bg-[#f5f5f5] duration-200"
            :class="selectedOption === option.value ? 'border-[#444BFF] bg-[#f5f5f5]' : 'border-[#e0e0e0]'"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div v-else class="text-center py-1">
        <p class="text-sm font-semibold">Thanks for your feedback!</p>
        <button
          @click="handleCloseClick"
          class="text-xs text-[#939393] hover:text-[#282828] mt-2"
        >
          Close
        </button>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useStore } from 'vuex';
import { trackEvent } from "@/utils/window";

const store = useStore();
const open = ref(false);
const hasFeedback = ref(false);
const selectedOption = ref<string | null>(null);

const options = [
  {
    value: 'good',
    label: '👍 Good',
  },
  {
    value: 'partial',
    label: '👌 Okay',
  },
  {
    value: 'bad',
    label: '👎 Poor',
  }
];

// Watch for AI diagram generation completion
watch(
  () => store.state.generating,
  async (newValue, oldValue) => {
    if (oldValue === true && newValue === false && store.state.lastDiagramWasAI) {
      // Wait a short moment after generation completes
      setTimeout(() => {
        open.value = true;
      }, 1000);
    }
  }
);

const handleOptionSelect = (value: string) => {
  selectedOption.value = value;
  trackEvent("ai_feedback", "click", { feedback: value });
  hasFeedback.value = true;
  setTimeout(() => {
    open.value = false;
  }, 2000);
};

const handleCloseClick = () => {
  open.value = false;
};
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: all 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
