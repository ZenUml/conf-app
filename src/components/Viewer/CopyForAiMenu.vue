<!--
  Chevron segment of the "Copy for AI" split button (GenericViewer.vue).
  Opens a menu of five job-framed entry points — same clipboard payload as
  the primary segment, only the copied preamble differs (buildCopyForAiPrompt.ts
  / job property, catalog.ts's copy_for_ai_clicked).

  Deliberately NOT a reuse of OverflowMenu.vue: that component anchors its
  popover upward (`bottom: calc(100% + 8px)`) because it lives in the BOTTOM
  pill row. This split button lives in the TOP viewer-edge-top row instead —
  an upward-opening popover there would extend above .viewer-frame's top
  edge and get clipped by that ancestor's `overflow: hidden`. So this is a
  fresh component, downward-anchored, but mirrors OverflowMenu's a11y bones
  exactly: role="menu"/"menuitem", Escape closes, click-outside closes,
  ArrowDown opens + focuses the first item, closing returns focus to the
  trigger.
-->
<template>
  <div ref="containerRef" class="copy-for-ai-menu">
    <button
      ref="triggerRef"
      type="button"
      class="copy-for-ai-menu-trigger"
      :class="{ 'copy-for-ai-menu-trigger--active': open }"
      aria-label="Copy for AI — more options"
      title="Copy for AI — more options"
      data-testid="copy-for-ai-menu-btn"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
      @keydown.down.prevent="openMenu"
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="copy-for-ai-menu-chevron" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
      </svg>
    </button>

    <div v-if="open" role="menu" aria-label="Copy for AI options" class="copy-for-ai-menu-popover">
      <button
        v-for="item in jobs"
        :key="item.job"
        type="button"
        role="menuitem"
        class="copy-for-ai-menu-item"
        :data-testid="`copy-for-ai-job-${item.job}`"
        @click="select(item.job)"
      >
        <span class="copy-for-ai-menu-item-label">{{ item.label }}</span>
        <span class="copy-for-ai-menu-item-desc">{{ item.description }}</span>
      </button>
    </div>
  </div>
</template>

<script>
// The five split-button menu entries. 'generic' (the primary segment) is not
// listed here — it never appears in this menu. Labels/descriptions per the
// settled design (2026-07-29) plus the 2026-07-30 rename of the first item.
const JOBS = [
  { job: 'explain', label: 'Ask about this flow', description: 'Get answers from the diagram and its page' },
  { job: 'update', label: 'Update this diagram', description: 'Describe a change, get paste-ready source back' },
  { job: 'implement', label: 'Implement this design', description: 'Take the spec into your coding agent' },
  { job: 'audit', label: 'Check against my codebase', description: 'Find where diagram and code disagree' },
  { job: 'tests', label: 'Generate test cases', description: 'Derive tests from this flow' },
]

export default {
  name: 'CopyForAiMenu',
  emits: ['select'],
  data() {
    return { open: false, jobs: JOBS }
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
    select(job) {
      this.$emit('select', job)
      this.close()
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
.copy-for-ai-menu {
  position: relative;
  display: inline-flex;
}

.copy-for-ai-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 4px;
  background: transparent;
  color: #374151;
  border: 1px solid transparent;
  border-left: 1px solid #E5E7EB;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
  transition: background-color 200ms ease, color 200ms ease;
}
.copy-for-ai-menu-trigger:hover,
.copy-for-ai-menu-trigger--active {
  background: #F3F4F6;
  color: #111827;
}
.copy-for-ai-menu-chevron {
  width: 14px;
  height: 14px;
}

.copy-for-ai-menu-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 280px;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 5;
}

.copy-for-ai-menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 4px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.copy-for-ai-menu-item:hover {
  background: #F3F4F6;
}
.copy-for-ai-menu-item:focus-visible {
  outline: 2px solid #2684FF;
  outline-offset: -2px;
}
.copy-for-ai-menu-item-label {
  font-size: 13px;
  font-weight: 600;
  color: #172B4D;
}
.copy-for-ai-menu-item-desc {
  font-size: 12px;
  color: #6B7280;
}
</style>
