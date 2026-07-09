<template>
  <span
    v-if="state === 'connected'"
    class="agent-link-live-badge"
    data-testid="agent-link-live-badge"
  >
    <span class="agent-link-live-badge__dot" aria-hidden="true"></span>
    live
  </span>
  <span
    v-else-if="state === 'suspended'"
    class="agent-link-live-badge agent-link-live-badge--suspended"
    data-testid="agent-link-live-badge-suspended"
    title="Connection paused — reopen fullscreen to resume"
  >
    <span class="agent-link-live-badge__dot" aria-hidden="true"></span>
    Paused
  </span>
  <span
    v-else-if="state === 'closed'"
    class="agent-link-live-badge agent-link-live-badge--closed"
    data-testid="agent-link-live-badge-closed"
  >
    Disconnected
  </span>
</template>

<script setup lang="ts">
// Shown on the collapsed (non-Fullscreen) macro while a session is linked
// (design §3 decision #8, §5.1): the iframe stays alive after Fullscreen
// closes, so the small macro needs its own "still connected" indicator.
//
// Track G extends this with 'suspended' (amber "Paused" — the relay socket
// dropped unexpectedly but is still resumable within the token TTL) and
// 'closed' (gray "Disconnected" — the terminal state, explicit disconnect
// or TTL expiry). Both are ADDITIVE — the original 'connected' branch above
// is untouched, so every existing collapsed-macro usage keeps rendering
// exactly as before; 'idle'/'waiting'/'timeout' still render nothing.
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

/* Track G: 'suspended' — amber "Paused", still pulsing (resumable). */
.agent-link-live-badge--suspended {
  background: rgba(226, 178, 3, 0.14);
  color: #c4761f;
}

.agent-link-live-badge--suspended .agent-link-live-badge__dot {
  background: #c4761f;
}

/* Track G: 'closed' — gray "Disconnected", terminal (no pulse). */
.agent-link-live-badge--closed {
  background: rgba(107, 119, 140, 0.14);
  color: #6b778c;
}
</style>
