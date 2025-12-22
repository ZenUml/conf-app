<template>
  <div class="tab-switcher" role="tablist">
    <button
      v-for="option in options"
      :key="option.value"
      role="tab"
      type="button"
      :aria-selected="modelValue === option.value"
      :tabindex="modelValue === option.value ? '0' : '-1'"
      :class="getButtonClass(option.value)"
      @click="handleSelect(option.value)"
    >
      <span :class="getTextClass(option.value)">
        {{ option.label }}
      </span>
    </button>
  </div>
</template>

<script>
export default {
  name: 'TabSwitcher',
  compatConfig: {
    COMPONENT_V_MODEL: false
  },
  props: {
    modelValue: {
      type: String,
      required: true
    },
    options: {
      type: Array,
      required: true,
      validator: (options) => {
        return options.every(opt => opt.value && opt.label)
      }
    }
  },
  emits: ['update:modelValue'],
  methods: {
    handleSelect(value) {
      if (value !== this.modelValue) {
        this.$emit('update:modelValue', value)
        // Save user's tab preference to localStorage
        localStorage.setItem('zenuml-preferred-diagram-type', value)
      }
    },
    getButtonClass(value) {
      const isActive = this.modelValue === value
      const baseClasses = 'px-3 py-1.5 rounded-md flex items-center text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus:outline-none transition-colors duration-200'
      const activeClasses = 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50'
      const inactiveClasses = 'text-gray-600 hover:text-gray-900 hover:bg-white/60'

      return isActive
        ? `${baseClasses} ${activeClasses}`.trim()
        : `${baseClasses} ${inactiveClasses}`.trim()
    },
    getTextClass(value) {
      const baseClasses = 'sr-only lg:not-sr-only'
      return baseClasses
    }
  }
}
</script>

<style scoped>
.tab-switcher {
  display: flex;
  padding: 0.25rem;
  border-radius: 0.5rem;
  background-color: rgb(243 244 246 / 0.5);
  flex-shrink: 0;
}

</style>
