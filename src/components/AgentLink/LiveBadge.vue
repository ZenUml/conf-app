<template>
  <span
    v-if="state === 'connected'"
    class="agent-link-live-badge"
    data-testid="agent-link-live-badge"
  >
    <span class="agent-link-live-badge__dot" aria-hidden="true"></span>
    live
  </span>
</template>

<script setup lang="ts">
// Shown on the collapsed (non-Fullscreen) macro while a session is linked
// (design §3 decision #8, §5.1): the iframe stays alive after Fullscreen
// closes, so the small macro needs its own "still connected" indicator.
import type { AgentLinkClientState } from '@/composables/agentLink/agentLinkState'

defineProps<{
  state: AgentLinkClientState
}>()
</script>

<style scoped>
.agent-link-live-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(22, 166, 107, 0.12);
  color: #16a66b;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.agent-link-live-badge__dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #16a66b;
  animation: agent-link-live-pulse 1.6s ease-in-out infinite;
}

@keyframes agent-link-live-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
</style>
