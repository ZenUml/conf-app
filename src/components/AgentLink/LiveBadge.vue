<template>
  <span
    v-if="state === 'connected'"
    class="agent-link-live-badge"
    :class="{ 'agent-link-live-badge--active': agentActive }"
    data-testid="agent-link-live-badge"
    role="status"
    aria-label="AI assistant connected"
  >
    <span class="agent-link-live-badge__dot" aria-hidden="true"></span>
    Connected
  </span>
  <span
    v-else-if="state === 'suspended'"
    class="agent-link-live-badge agent-link-live-badge--suspended"
    data-testid="agent-link-live-badge-suspended"
    role="status"
    aria-live="polite"
    aria-label="Connecting AI assistant"
  >
    <span class="agent-link-live-badge__dot" aria-hidden="true"></span>
    Connecting
  </span>
  <span
    v-else-if="state === 'closed'"
    class="agent-link-live-badge agent-link-live-badge--closed"
    data-testid="agent-link-live-badge-closed"
  >
    Disconnected
  </span>
  <span
    v-else-if="state === 'expired'"
    class="agent-link-live-badge agent-link-live-badge--closed"
    data-testid="agent-link-live-badge-expired"
  >
    Expired
  </span>
</template>

<script setup lang="ts">
// Shown on the collapsed macro while a session is linked, and reused by the
// fullscreen identity header. Automatic recovery is intentionally only this
// compact amber signal; the panel body remains unchanged.
import type { AgentLinkClientState } from '@/composables/agentLink/agentLinkState'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ACTIVITY_LINGER_MS } from '@/composables/agentLink/useAgentLinkSession'

const props = withDefaults(
  defineProps<{
    state: AgentLinkClientState
    lastActivityAt?: number | null
  }>(),
  { lastActivityAt: null }
)

const nowMs = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

function startTicking() {
  stopTicking()
  nowMs.value = Date.now()
  timer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
}
function stopTicking() {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

watch(
  () => props.lastActivityAt,
  (value) => {
    if (value === null || value === undefined) stopTicking()
    else startTicking()
  },
  { immediate: true }
)

onBeforeUnmount(stopTicking)

const agentActive = computed(() => {
  if (props.lastActivityAt === null || props.lastActivityAt === undefined) return false
  return nowMs.value - props.lastActivityAt < ACTIVITY_LINGER_MS
})
</script>

<style scoped>
.agent-link-live-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  color: #16a66b;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.agent-link-live-badge__dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #16a66b;
}

.agent-link-live-badge--active .agent-link-live-badge__dot {
  animation: agent-link-live-pulse 1.6s ease-in-out infinite;
}

@keyframes agent-link-live-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.agent-link-live-badge--suspended {
  color: #c4761f;
}

.agent-link-live-badge--suspended .agent-link-live-badge__dot {
  position: relative;
  background: #c4761f;
}

.agent-link-live-badge--suspended .agent-link-live-badge__dot::after {
  content: '';
  position: absolute;
  inset: -4px;
  border: 1px solid currentColor;
  border-radius: 50%;
  opacity: 0;
  animation: agent-link-connecting-wave 1.35s ease-out infinite;
}

@keyframes agent-link-connecting-wave {
  0% { opacity: 0.35; transform: scale(0.45); }
  100% { opacity: 0; transform: scale(1.25); }
}

.agent-link-live-badge--closed {
  color: #6b778c;
}

@media (prefers-reduced-motion: reduce) {
  .agent-link-live-badge--active .agent-link-live-badge__dot,
  .agent-link-live-badge--suspended .agent-link-live-badge__dot::after {
    animation: none;
  }
}
</style>
