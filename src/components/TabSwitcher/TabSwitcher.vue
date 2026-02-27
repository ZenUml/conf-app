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
      const baseClasses = 'px-3 py-1.5 rounded-md flex items-center gap-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus:outline-none transition-colors duration-200'
      const inactiveClasses = 'text-gray-600 hover:text-gray-900 hover:bg-white/60'

      if (!isActive) return `${baseClasses} ${inactiveClasses}`.trim()

      const activeByType = {
        sequence: 'bg-amber-50 text-amber-700 border-2 border-amber-400 hover:bg-amber-100 focus-visible:ring-amber-400',
        mermaid:  'bg-emerald-50 text-emerald-700 border-2 border-emerald-400 hover:bg-emerald-100 focus-visible:ring-emerald-400',
        plantuml: 'bg-violet-50 text-violet-700 border-2 border-violet-400 hover:bg-violet-100 focus-visible:ring-violet-400',
      }
      return `${baseClasses} ${activeByType[value] ?? 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50'}`.trim()
    },
    getDotClass(value) {
      const isActive = this.modelValue === value
      const base = 'w-2 h-2 rounded-full flex-shrink-0'
      const dotByType = {
        sequence: isActive ? `${base} bg-amber-500`  : `${base} bg-amber-300`,
        mermaid:  isActive ? `${base} bg-emerald-500`: `${base} bg-emerald-300`,
        plantuml: isActive ? `${base} bg-violet-500` : `${base} bg-violet-300`,
      }
      return dotByType[value] ?? `${base} bg-gray-400`
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
  padding: 0.25rem;
  border-radius: 0.5rem;
  background-color: rgb(243 244 246 / 0.5);
  flex-shrink: 0;
}

</style>
