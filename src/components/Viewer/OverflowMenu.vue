<template>
  <div ref="containerRef" class="overflow-menu">
    <button
      ref="triggerRef"
      type="button"
      class="viewer-pill-btn overflow-menu-trigger"
      :class="{ 'overflow-menu-trigger--active': open }"
      :aria-label="triggerLabel"
      :title="triggerLabel"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
      @keydown.down.prevent="openMenu"
    >
      <svg
        class="viewer-icon"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
      </svg>
    </button>

    <div v-if="open" role="menu" :aria-label="triggerLabel" class="overflow-menu-popover">
      <slot :close="close" />
      <div class="overflow-menu-arrow" aria-hidden="true"></div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'OverflowMenu',
  props: {
    triggerLabel: { type: String, default: 'More' },
  },
  data() {
    return { open: false }
  },
  mounted() {
    document.addEventListener('mousedown', this.onDocMouseDown)
    document.addEventListener('keydown', this.onKeyDown)
  },
  beforeUnmount() {
    document.removeEventListener('mousedown', this.onDocMouseDown)
    document.removeEventListener('keydown', this.onKeyDown)
  },
  methods: {
    toggle() {
      if (this.open) this.close()
      else this.openMenu()
    },
    openMenu() {
      if (this.open) return
      this.open = true
      this.$nextTick(() => {
        const firstItem = this.$refs.containerRef?.querySelector('[role="menuitem"]')
        firstItem?.focus()
      })
    },
    close() {
      if (!this.open) return
      this.open = false
      this.$refs.triggerRef?.focus()
    },
    onDocMouseDown(e) {
      if (this.open && this.$refs.containerRef && !this.$refs.containerRef.contains(e.target)) {
        this.open = false
      }
    },
    onKeyDown(e) {
      if (e.key === 'Escape' && this.open) {
        e.stopPropagation()
        this.close()
      }
    },
  },
}
</script>

<style scoped>
.overflow-menu {
  position: relative;
  display: inline-flex;
}

.overflow-menu-trigger--active {
  background: #F3F4F6;
  color: #374151;
}

.overflow-menu-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 180px;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 0;
  z-index: 5;
}

.overflow-menu-arrow {
  position: absolute;
  right: 10px;
  bottom: -5px;
  width: 10px;
  height: 10px;
  background: #fff;
  border-right: 1px solid #E5E7EB;
  border-bottom: 1px solid #E5E7EB;
  transform: rotate(45deg);
}
</style>

<style>
.overflow-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 4px;
  font-family: inherit;
  font-size: 13px;
  color: #374151;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.overflow-menu-item:hover {
  background: #F3F4F6;
  color: #111827;
}
.overflow-menu-item:focus-visible {
  outline: 2px solid #2684FF;
  outline-offset: -2px;
}
.overflow-menu-item-icon {
  display: inline-flex;
  color: #6B7280;
  flex-shrink: 0;
}
.overflow-menu-item-icon svg {
  width: 14px;
  height: 14px;
}
</style>
