<template>
  <!-- Track H: additive "Working" variant — an op is in flight on an otherwise
       live session (thinking axis, orthogonal to the FSM). Takes precedence
       over the green "live" badge but ONLY when `thinking` is passed, so every
       existing usage (collapsed macro, no `thinking` prop) renders exactly as
       before. -->
  <span
    v-if="state === 'connected' && thinking"
    class="agent-link-live-badge agent-link-live-badge--working"
    data-testid="agent-link-live-badge-working"
  >
    <svg
      class="agent-link-live-badge__spinner"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
    Working
  </span>
  <span
    v-else-if="state === 'connected'"
    class="agent-link-live-badge"
    :class="{ 'agent-link-live-badge--active': agentActive }"
    data-testid="agent-link-live-badge"
  >
    <span class="agent-link-live-badge__dot" aria-hidden="true"></span>
    live
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
// Shown on the collapsed (non-Fullscreen) macro while a session is linked
// (design §3 decision #8, §5.1): the iframe stays alive after Fullscreen
// closes, so the small macro needs its own "still connected" indicator.
//
// Track G extends this with 'suspended' (amber "Connecting" — the relay socket
// dropped unexpectedly but is still resumable within the token TTL) and
// 'closed' (gray "Disconnected" — the terminal state, explicit disconnect).
// #314 adds 'expired' (gray "Expired" — the client-side TTL watchdog noticed
// the minted token's own lapse, reusing the same muted --closed styling
// since both are non-live terminal states, just with different copy). All
// ADDITIVE — the original 'connected' branch above is untouched, so every
// existing collapsed-macro usage keeps rendering exactly as before;
// 'idle'/'waiting'/'timeout' still render nothing.
import type { AgentLinkClientState } from '@/composables/agentLink/agentLinkState'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ACTIVITY_LINGER_MS } from '@/composables/agentLink/useAgentLinkSession'

const props = withDefaults(
  defineProps<{
    state: AgentLinkClientState
    // Track H: op-in-flight overlay for the rail's status header. Optional and
    // false by default so the collapsed-macro badge is unchanged.
    thinking?: boolean
    lastActivityAt?: number | null
  }>(),
  { thinking: false, lastActivityAt: null }
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
  (v) => {
    if (v === null || v === undefined) stopTicking()
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
}

.agent-link-live-badge--active .agent-link-live-badge__dot {
  animation: agent-link-live-pulse 1.6s ease-in-out infinite;
}

@keyframes agent-link-live-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* Track H: 'Working' — blue, an op in flight on a live session. Uses the
   sanctioned async pattern (ArrowPathIcon + spin), no pulse dot. */
.agent-link-live-badge--working {
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}

.agent-link-live-badge__spinner {
  width: 12px;
  height: 12px;
  animation: agent-link-live-spin 1s linear infinite;
}

@keyframes agent-link-live-spin {
  to { transform: rotate(360deg); }
}

/* Track G: 'suspended' — lightweight amber connection status. */
.agent-link-live-badge--suspended {
  background: rgba(226, 178, 3, 0.14);
  color: #c4761f;
}

.agent-link-live-badge--suspended .agent-link-live-badge__dot {
  background: #c4761f;
  animation: agent-link-live-pulse 1.6s ease-in-out infinite;
}

/* Track G: 'closed' — gray "Disconnected", terminal (no pulse). */
.agent-link-live-badge--closed {
  background: rgba(107, 119, 140, 0.14);
  color: #6b778c;
}

@media (prefers-reduced-motion: reduce) {
  .agent-link-live-badge--active .agent-link-live-badge__dot {
    animation: none;
  }

  .agent-link-live-badge--suspended .agent-link-live-badge__dot {
    animation: none;
  }

  .agent-link-live-badge__spinner {
    animation: none;
  }
}
</style>
