<template>
  <div class="tab-switcher">
    <Notch :model-value="modelValue" :items="options" @update:model-value="select" />
  </div>
</template>

<script>
import Notch from '@/components/Notch/Notch.vue'

export default {
  name: 'TabSwitcher',
  components: { Notch },
  props: {
    modelValue: { type: String, required: true },
    options: { type: Array, required: true },
  },
  emits: ['update:modelValue'],
  methods: {
    select(value) {
      if (value !== this.modelValue) {
        this.$emit('update:modelValue', value)
        localStorage.setItem('zenuml-preferred-diagram-type', value)
      }
    },
  },
}
</script>
