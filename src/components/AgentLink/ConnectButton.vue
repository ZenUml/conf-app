<template>
  <button
    type="button"
    class="agent-link-connect-btn"
    data-testid="agent-link-connect-btn"
    @click="emit('connect')"
  >
    <svg
      class="agent-link-connect-btn__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
      <path d="M12 8v4l3 2" />
    </svg>
    <span>Connect to Agent</span>
  </button>
</template>

<script setup lang="ts">
// Purely an affordance: the parent (macro / Fullscreen host) opens
// Fullscreen and calls useAgentLinkSession().startConnect() in response to
// this emit — this component fires nothing itself
// (docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.1, §9).
const emit = defineEmits<{
  (e: 'connect'): void
}>()
</script>

<style scoped>
/* Track H: retired the ad-hoc violet (#6c4cf0 — not a DESIGN.md token) for the
   system agent accent, blue-600 → blue-700 on hover. */
.agent-link-connect-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: #2563eb;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 200ms ease;
}

.agent-link-connect-btn:hover {
  background: #1d4ed8;
}

.agent-link-connect-btn:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.agent-link-connect-btn__icon {
  flex-shrink: 0;
}
</style>
