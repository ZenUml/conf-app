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
      <span :class="getDotClass(option.value)" aria-hidden="true"></span>
      <span :class="getTextClass()">
        {{ option.label }}
      </span>
    </button>
  </div>
</template>

<script>
export default {
  name: 'TabSwitcher',
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
      const baseClasses = 'relative px-3.5 h-full flex items-center gap-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus:outline-none transition-colors duration-200 after:content-[""] after:absolute after:left-3 after:right-3 after:bottom-[5px] after:h-[2px] after:rounded-t-sm'
      const inactiveClasses = 'text-gray-500 hover:text-gray-900 after:bg-transparent'

      if (!isActive) return `${baseClasses} ${inactiveClasses}`.trim()

      const activeByType = {
        sequence: 'text-[#054E76] after:bg-[#0094D9] focus-visible:ring-[#0094D9]',
        mermaid:  'text-[#8E0F33] after:bg-[#FF3670] focus-visible:ring-[#FF3670]',
        plantuml: 'text-[#6B2900] after:bg-[#B84800] focus-visible:ring-[#B84800]',
      }
      return `${baseClasses} ${activeByType[value] ?? 'text-blue-800 after:bg-blue-500'}`.trim()
    },
    getDotClass(value) {
      const isActive = this.modelValue === value
      const base = 'w-[7px] h-[7px] rounded-full flex-shrink-0 transition-colors duration-200'
      const dotByType = {
        sequence: isActive ? `${base} bg-[#0094D9]` : `${base} bg-gray-300`,
        mermaid:  isActive ? `${base} bg-[#FF3670]` : `${base} bg-gray-300`,
        plantuml: isActive ? `${base} bg-[#B84800]` : `${base} bg-gray-300`,
      }
      return dotByType[value] ?? `${base} bg-gray-300`
    },
    getTextClass() {
      return 'sr-only lg:not-sr-only'
    }
  }
}
</script>

<style scoped>
.tab-switcher {
  display: flex;
  align-items: stretch;
  height: 31px;
  flex-shrink: 0;
}

</style>
