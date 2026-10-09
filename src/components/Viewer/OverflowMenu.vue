<template>
  <div ref="containerRef" class="overflow-menu">
    <button
      ref="triggerRef"
      type="button"
      class="overflow-menu-trigger"
      :class="{ 'overflow-menu-trigger--active': open }"
      :aria-label="triggerLabel"
      :title="triggerLabel"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
      @keydown.down.prevent="openMenu"
      @keydown.up.prevent="openMenu"
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

    <div
      v-if="open"
      ref="menuRef"
      role="menu"
      :aria-label="menuLabel || triggerLabel"
      class="overflow-menu-popover"
      :class="[`overflow-menu-popover--${placement}`, { 'overflow-menu-popover--start': alignStart }]"
      @keydown="onMenuKeydown"
    >
      <slot :close="close" />
    </div>
  </div>
</template>

<script>
import { handleMenuKeydown, shouldAlignMenuStart } from './menuKeyboard'

/**
 * Icon-trigger menu ("More", ⋯). Lives in the viewer header since the staged
 * header (2026-10) replaced the bottom pill, so the popover opens downward by
 * default; `placement="top"` keeps the old upward anchor for a host at the
 * bottom of a clipped container. Emits `opened` / `closed` so the host can
 * keep its chrome revealed while the menu is open.
 */
export default {
  name: 'OverflowMenu',
  props: {
    triggerLabel: { type: String, default: 'More' },
    menuLabel: { type: String, default: '' },
    placement: { type: String, default: 'bottom', validator: v => v === 'top' || v === 'bottom' },
  },
  emits: ['opened', 'closed'],
  data() {
    return { open: false, alignStart: false }
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
      this.$emit('opened')
      this.alignStart = false
      this.$nextTick(() => {
        this.alignStart = shouldAlignMenuStart(this.$refs.menuRef)
        const firstItem = this.$refs.containerRef?.querySelector('[role="menuitem"]:not([disabled])')
        firstItem?.focus()
      })
    },
    // Closes and returns focus to the trigger (Escape, an item picked).
    close() {
      if (!this.open) return
      this.open = false
      this.$emit('closed')
      this.$refs.triggerRef?.focus()
    },
    // Closes without moving focus (Tab, a click elsewhere).
    dismiss() {
      if (!this.open) return
      this.open = false
      this.$emit('closed')
    },
    onMenuKeydown(e) {
      handleMenuKeydown(e, this.$refs.menuRef, { close: this.close, dismiss: this.dismiss })
    },
    onDocMouseDown(e) {
      if (this.open && this.$refs.containerRef && !this.$refs.containerRef.contains(e.target)) {
        this.dismiss()
      }
    },
    // Escape while focus is outside the menu (e.g. still on the trigger).
    onKeyDown(e) {
      if (e.key === 'Escape' && this.open) {
        e.preventDefault()
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

/* Header icon button (staged-header prototype): 28px square, 6px radius. */
.overflow-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  color: #6B7280;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 200ms ease, color 200ms ease;
}

.overflow-menu-trigger:hover,
.overflow-menu-trigger--active {
  background: #F3F4F6;
  color: #374151;
}

.overflow-menu-trigger:focus-visible {
  outline: 2px solid #0C66E4;
  outline-offset: 1px;
}

.overflow-menu-trigger > .viewer-icon {
  width: 16px;
  height: 16px;
}

/* Trigger styling is owned locally by OverflowMenu so the trigger isn't dependent on a parent's scoped CSS reaching across data-v hashes. */

.overflow-menu-popover {
  position: absolute;
  right: 0;
  display: flex;
  flex-direction: column;
  min-width: 210px;
  padding: 4px;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.10);
  z-index: 20;
}
.overflow-menu-popover--bottom { top: calc(100% + 4px); }
.overflow-menu-popover--top { bottom: calc(100% + 4px); }
.overflow-menu-popover--start { right: auto; left: 0; }
</style>

<style>
.overflow-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  color: #374151;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.overflow-menu-item:hover {
  background: #F3F4F6;
  color: #111827;
}
.overflow-menu-item:focus-visible {
  background: #F3F4F6;
  outline: 2px solid #0C66E4;
  outline-offset: -2px;
}
.overflow-menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.overflow-menu-item-icon {
  display: inline-flex;
  color: #6B7280;
  flex-shrink: 0;
}
.overflow-menu-item-icon svg {
  width: 16px;
  height: 16px;
}
.overflow-menu-separator {
  height: 1px;
  margin: 4px 0;
  background: #E5E7EB;
}
</style>
