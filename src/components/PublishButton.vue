<template>
  <div class="save-and-exit inline-block">
    <button aria-label="Publish" class="flex items-center bg-blue-700 px-2 py-1 text-white text-sm font-semibold rounded disabled:bg-gray-300" @click="saveAndExit" :disabled="disabled">
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
