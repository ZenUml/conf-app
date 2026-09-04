<template>
  <div ref="slot" class="relative h-[30px] shrink-0" :style="{ width: `${geometry.width}px` }">
    <div
      ref="plane"
      class="absolute inset-0 grid h-[30px] min-w-0 items-stretch px-9"
      :style="{ gridTemplateColumns: `repeat(${items.length}, minmax(max-content, 1fr))` }"
      role="tablist"
      :aria-label="groupLabel"
    >
      <svg class="pointer-events-none absolute inset-0 h-full w-full overflow-visible drop-shadow-[0_1px_3px_rgb(0_0_0_/_6%)]" aria-hidden="true">
        <path :d="geometry.fillPath" fill="#FFFFFF" />
        <path :d="geometry.strokePath" fill="none" stroke="#E5E7EB" stroke-width="1" />
      </svg>
      <button
        v-for="(item, index) in items"
        :key="item.value"
        class="group/notch relative flex h-full min-w-0 items-center justify-center gap-2 border-0 bg-transparent px-3 text-[13px] leading-none whitespace-nowrap transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
        :class="buttonClass(item)"
        :style="buttonStyle(item)"
        type="button"
        role="tab"
        :aria-selected="modelValue === item.value"
        :tabindex="modelValue === item.value ? 0 : -1"
        @click="select(item.value)"
      >
        <span v-if="index" class="absolute left-0 top-1/2 h-3 w-px -translate-y-1/2 bg-[#E5E7EB]" aria-hidden="true" />
        <span class="h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200" :style="dotStyle(item)" aria-hidden="true" />
        <span class="grid overflow-hidden">
          <span class="col-start-1 row-start-1">{{ item.label }}</span>
          <span class="col-start-1 row-start-1 invisible font-semibold" aria-hidden="true">{{ item.label }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<script>
import { getNotchGeometry } from './notchGeometry'

export default {
  name: 'Notch',
  props: {
    modelValue: { type: String, required: true },
    items: { type: Array, required: true },
    groupLabel: { type: String, default: 'Document type' },
  },
  emits: ['update:modelValue'],
  data() {
    return { measuredWidth: 0, resizeObserver: null }
  },
  computed: {
    geometry() {
      return getNotchGeometry(this.measuredWidth)
    },
  },
  mounted() {
    const measure = () => {
      const plane = this.$refs.plane
      if (!plane) return
      // CSS Grid's max-content tracks can paint outside the plane without
      // increasing scrollWidth. Measure the rendered tab tracks instead, then
      // reserve both shoulder insets so the first and last labels remain on
      // the notch's flat underside rather than bleeding into its curves.
      const tabWidth = [...plane.querySelectorAll('[role="tab"]')]
        .reduce((total, tab) => total + tab.getBoundingClientRect().width, 0)
      const style = getComputedStyle(plane)
      const shoulders = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      this.measuredWidth = Math.ceil(tabWidth + shoulders)
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(measure)
      this.resizeObserver.observe(this.$refs.plane)
    }
  },
  beforeUnmount() {
    this.resizeObserver?.disconnect()
  },
  methods: {
    select(value) {
      if (value !== this.modelValue) this.$emit('update:modelValue', value)
    },
    buttonClass(item) {
      const active = this.modelValue === item.value
      return active
        ? 'font-semibold'
        : 'font-medium text-gray-500'
    },
    buttonStyle(item) {
      return this.modelValue === item.value ? { color: this.colors(item).active } : undefined
    },
    dotStyle(item) {
      return { backgroundColor: this.modelValue === item.value ? this.colors(item).accent : '#D1D5DB' }
    },
    colors(item) {
      return {
        sequence: { accent: '#0094D9', active: '#054E76' },
        mermaid: { accent: '#FF3670', active: '#8E0F33' },
        plantuml: { accent: '#B84800', active: '#6B2900' },
      }[item.value] || { accent: '#6B7280', active: '#1F2937' }
    },
  },
}
</script>
