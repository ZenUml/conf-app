<!--
  Multi-page navigation for Graph (DrawIO) diagrams: prev / "N of M" / next.
  Rendered into GenericViewer's #header-nav slot (staged header, 2026-10),
  which places it in the header and keeps it visible without hover.
-->
<template>
  <button
    type="button"
    @click="$emit('go', currentPage - 1)"
    :disabled="currentPage <= 0"
    title="Previous page"
    aria-label="Previous page"
    class="viewer-page-nav-btn"
  >
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-page-nav-icon" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  </button>
  <span class="viewer-page-nav-label" aria-live="polite">{{ currentPage + 1 }} of {{ pageCount }}</span>
  <button
    type="button"
    @click="$emit('go', currentPage + 1)"
    :disabled="currentPage >= pageCount - 1"
    title="Next page"
    aria-label="Next page"
    class="viewer-page-nav-btn"
  >
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-page-nav-icon" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  </button>
</template>

<script>
export default {
  name: 'GraphPageNav',
  props: {
    currentPage: { type: Number, required: true },
    pageCount: { type: Number, required: true },
  },
  emits: ['go'],
}
</script>

<style scoped>
/* Page navigation in GenericViewer's header (staged-header prototype):
   28px icon buttons and a "1 of 3" label. */
.viewer-page-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #6B7280;
  cursor: pointer;
  transition: background-color 200ms ease, color 200ms ease;
}
.viewer-page-nav-btn:hover:not(:disabled) { background: #F3F4F6; color: #374151; }
.viewer-page-nav-btn:focus-visible { outline: 2px solid #0C66E4; outline-offset: 1px; }
.viewer-page-nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.viewer-page-nav-icon { width: 16px; height: 16px; }
.viewer-page-nav-label {
  padding: 0 6px;
  font-size: 12px;
  font-weight: 500;
  color: #44546F;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  user-select: none;
}
</style>
