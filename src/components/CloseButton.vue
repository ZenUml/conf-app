<template>
  <div class="save-and-exit inline-block">
    <button class="flex items-center border-2 border-blue-600 px-3 py-2 text-blue-600 text-sm font-medium rounded-md hover:bg-blue-50 transition-colors duration-200"
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
