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
      <span :class="getDotClass(option.value)" aria-hidden="true" />
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
      const baseClasses = 'group/tab relative px-3.5 h-full flex items-center gap-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus:outline-none transition-colors duration-200 after:content-[""] after:absolute after:left-3 after:right-3 after:bottom-[5px] after:h-[2px] after:rounded-t-sm'

      const typeStyles = {
        sequence: {
          hover: 'hover:text-[#0094D9]',
          active: 'text-[#054E76] after:bg-[#0094D9] focus-visible:ring-[#0094D9]',
        },
        mermaid: {
          hover: 'hover:text-[#FF3670]',
          active: 'text-[#8E0F33] after:bg-[#FF3670] focus-visible:ring-[#FF3670]',
        },
        plantuml: {
          hover: 'hover:text-[#B84800]',
          active: 'text-[#6B2900] after:bg-[#B84800] focus-visible:ring-[#B84800]',
        },
      }
      const styles = typeStyles[value] ?? {
        hover: 'hover:text-blue-600',
        active: 'text-blue-800 after:bg-blue-500 focus-visible:ring-blue-500',
      }

      if (!isActive) {
        return `${baseClasses} text-gray-500 ${styles.hover} after:bg-transparent`.trim()
      }
      return `${baseClasses} ${styles.active}`.trim()
    },
    getDotClass(value) {
      const isActive = this.modelValue === value
      const base = 'w-[7px] h-[7px] rounded-full flex-shrink-0 transition-colors duration-200'
      const accentDot = {
        sequence: 'bg-[#0094D9]',
        mermaid: 'bg-[#FF3670]',
        plantuml: 'bg-[#B84800]',
      }
      const hoverDot = {
        sequence: 'group-hover/tab:bg-[#0094D9]',
        mermaid: 'group-hover/tab:bg-[#FF3670]',
        plantuml: 'group-hover/tab:bg-[#B84800]',
      }
      if (isActive) {
        return `${base} ${accentDot[value] ?? 'bg-gray-300'}`.trim()
      }
      return `${base} bg-gray-300 ${hoverDot[value] ?? ''}`.trim()
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
