<template>
  <div class="save-and-exit inline-block">
    <button class="flex items-center bg-blue-700 px-2 py-1 text-white text-sm font-semibold rounded disabled:bg-gray-300"
      @click="exit">
      <span>Close</span>
    </button>
  </div>
</template>

<script>
export default {
  name: "CloseButton",
  props: ['exit'],
}
</script>
