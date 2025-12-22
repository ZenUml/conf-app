<template>
  <div class="save-and-exit inline-block">
    <button aria-label="Publish" class="flex items-center bg-blue-600 px-3 py-2 text-white text-sm font-medium rounded-md hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors duration-200" @click="saveAndExit" :disabled="disabled">
      <span>Publish</span>
    </button>
  </div>
</template>

<script>
export default {
  name: "PublishButton",
  props: ['saveAndExit', 'disabled'],
}
</script>
