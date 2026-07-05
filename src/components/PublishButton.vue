<template>
  <div class="save-and-exit inline-block">
    <button aria-label="Publish" :aria-busy="loading ? 'true' : 'false'" class="flex items-center gap-1.5 bg-blue-600 px-3 py-2 text-white text-sm font-medium rounded-md hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors duration-200" @click="saveAndExit" :disabled="disabled || loading">
      <svg v-if="loading" class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span>{{ loading ? 'Publishing…' : 'Publish' }}</span>
    </button>
  </div>
</template>

<script>
export default {
  name: "PublishButton",
  props: ['saveAndExit', 'disabled', 'loading'],
}
</script>
