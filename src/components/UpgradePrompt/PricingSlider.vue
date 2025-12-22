<template>
  <div class="mb-4">
    <div class="flex items-center gap-1.5">
      <label for="confluence-users" class="text-xs text-gray-700 font-medium">
        Number of users in your Confluence instance
      </label>
      <!-- Tooltip -->
      <div class="group relative">
        <button
          type="button"
          class="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="How to find your user count"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" class="w-full h-full">
            <path fill-rule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm0-1.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM8 7a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 7zm0-3a1 1 0 100 2 1 1 0 000-2z"/>
          </svg>
        </button>
        <div class="hidden group-hover:block absolute bottom-full left-0 mb-2 w-64 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-10 pointer-events-none">
          Enter the number of users specified for your Confluence instance in Settings then User Management.
          <div class="absolute w-2 h-2 bg-gray-800 transform rotate-45 -bottom-1 left-8"></div>
        </div>
      </div>
    </div>

    <!-- Slider with visual pricing zones (logarithmic scale) -->
    <div class="relative">
      <input
        id="confluence-users"
        :value="modelValue"
        type="range"
        min="0"
        max="100"
        step="1"
        @input="$emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
        class="w-full h-2 appearance-none cursor-pointer slider-zones"
        aria-label="Total Confluence Users in Your Organization"
      />

      <!-- Tick marks (user counts) -->
      <div class="absolute -bottom-0 left-0 right-0 text-xs text-gray-600 font-semibold pointer-events-none">
        <span class="absolute" style="left: 0%; transform: translateX(0%)">10</span>
        <span class="absolute" style="left: 9%; transform: translateX(-50%)">100</span>
        <span class="absolute" style="left: 24%; transform: translateX(-50%)">250</span>
        <span class="absolute" style="left: 62%; transform: translateX(-50%)">1K</span>
        <span class="absolute" style="left: 100%; transform: translateX(-100%)">10K</span>
      </div>
    </div>

    <!-- Notice below slider -->
    <div class="flex items-center gap-1.5 mt-5 text-xs text-gray-500">
      <svg class="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
        <path fill-rule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm0-1.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM8 7a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 7zm0-3a1 1 0 100 2 1 1 0 000-2z"/>
      </svg>
      <span>We don't have access to your user count</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: number
}>()

defineEmits<{
  (e: 'update:modelValue', value: number): void
}>()
</script>

<style scoped>
/* Slider with visual pricing zones */
.slider-zones {
  background: transparent;
  outline: none;
}

/* Track styling - 4 colored zones for pricing tiers (logarithmic distribution) */
.slider-zones::-webkit-slider-runnable-track {
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(to right,
    #dbeafe 0%, #dbeafe 9%,      /* 10-100: $0.44 (light blue) */
    #93c5fd 9%, #93c5fd 24%,     /* 101-250: $0.33 (medium blue) */
    #3b82f6 24%, #3b82f6 62%,    /* 251-1000: $0.11 (blue) */
    #2563eb 62%, #2563eb 100%    /* 1001-10000: $0.05 (dark blue) */
  );
}

.slider-zones::-moz-range-track {
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(to right,
    #dbeafe 0%, #dbeafe 9%,
    #93c5fd 9%, #93c5fd 24%,
    #3b82f6 24%, #3b82f6 62%,
    #2563eb 62%, #2563eb 100%
  );
}

/* Thumb styling - white with darker blue border for contrast */
.slider-zones::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ffffff;
  border: 3px solid #1e40af;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  cursor: grab;
  margin-top: -6px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.slider-zones::-webkit-slider-thumb:hover {
  border-color: #1e3a8a;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  transform: scale(1.1);
}

.slider-zones::-webkit-slider-thumb:active {
  cursor: grabbing;
  transform: scale(1.05);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.slider-zones::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ffffff;
  border: 3px solid #1e40af;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  cursor: grab;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.slider-zones::-moz-range-thumb:hover {
  border-color: #1e3a8a;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  transform: scale(1.1);
}

.slider-zones::-moz-range-thumb:active {
  cursor: grabbing;
  transform: scale(1.05);
}
</style>
