<template>
  <!-- Toolbar link-status chip (design contract §Region→component: LinkStatusChip).
       Names the bound diagram + a live token countdown. Only meaningful once a
       session exists (connected / suspended / closed) — renders nothing while
       idle/waiting/timeout so the pre-pairing toolbar is unchanged. -->
  <span
    v-if="variant"
    class="agent-chip"
    :class="[`agent-chip--${variant}`, { 'agent-chip--warn-ttl': isWarnTtl }]"
    data-testid="agent-link-status-chip"
  >
    <!-- live / disconnected: a status dot; suspended: a spinner -->
    <svg
      v-if="variant === 'suspended'"
      class="agent-chip__spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
    <span v-else class="agent-chip__dot" aria-hidden="true"></span>

    <template v-if="variant === 'live'">
      <b>Linked</b>
      <span class="agent-chip__sep">·</span>
      <span class="agent-chip__title">{{ diagramTitle || 'this diagram' }}</span>
      <template v-if="ttlText">
        <span class="agent-chip__sep">·</span>
        <span class="agent-chip__ttl" data-testid="agent-link-status-chip-ttl">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>{{ ttlText }}
        </span>
      </template>
    </template>
    <template v-else-if="variant === 'suspended'">Reconnecting…</template>
    <template v-else>Disconnected</template>
  </span>
</template>

<script setup lang="ts">
// Maps the connection FSM to the toolbar chip. Ticks its own TTL clock (like
// SessionTtl) so the host doesn't have to. Tokens: success #36B37E live /
// warning #E2B203 amber under 120 s / gray disconnected.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AgentLinkClientState } from '@/composables/agentLink/agentLinkState'

const props = withDefaults(
  defineProps<{
    state: AgentLinkClientState
    diagramTitle?: string
    expiresAt?: number | null
  }>(),
  { diagramTitle: '', expiresAt: null }
)

const WARN_THRESHOLD_SECONDS = 120

const variant = computed<'live' | 'suspended' | 'dead' | null>(() => {
  switch (props.state) {
    case 'connected':
      return 'live'
    case 'suspended':
      return 'suspended'
    case 'closed':
      return 'dead'
    default:
      return null
  }
})

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
  () => [props.expiresAt, variant.value] as const,
  ([exp, v]) => {
    if (exp === null || exp === undefined || v !== 'live') stopTicking()
    else startTicking()
  },
  { immediate: true }
)

onBeforeUnmount(stopTicking)

const remainingSeconds = computed<number | null>(() => {
  if (props.expiresAt === null || props.expiresAt === undefined) return null
  return Math.max(0, Math.ceil((props.expiresAt - nowMs.value) / 1000))
})

const isWarnTtl = computed(
  () => remainingSeconds.value !== null && remainingSeconds.value < WARN_THRESHOLD_SECONDS
)

const ttlText = computed(() => {
  if (remainingSeconds.value === null) return ''
  const s = remainingSeconds.value
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
})
</script>

<style scoped>
.agent-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  transition: background-color 200ms ease;
}
.agent-chip b {
  font-weight: 600;
}
.agent-chip__sep {
  opacity: 0.5;
}
.agent-chip__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.agent-chip__spin {
  width: 13px;
  height: 13px;
  animation: agent-chip-spin 1.1s linear infinite;
}
.agent-chip__title {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}
.agent-chip__ttl {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-variant-numeric: tabular-nums;
}
.agent-chip__ttl svg {
  width: 13px;
  height: 13px;
}

.agent-chip--live {
  background: #e7f6ef;
  color: #1f7a54;
  border-color: #cbebdb;
}
.agent-chip--live .agent-chip__dot {
  background: #36b37e;
}
.agent-chip--live.agent-chip--warn-ttl .agent-chip__ttl {
  color: #8a6d00;
  font-weight: 600;
}

.agent-chip--suspended {
  background: #fbf3d6;
  color: #8a6d00;
}

.agent-chip--dead {
  background: #f1f2f4;
  color: #6b778c;
}
.agent-chip--dead .agent-chip__dot {
  background: #97a0af;
}

@keyframes agent-chip-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .agent-chip__spin {
    animation: none;
  }
}
@media (prefers-color-scheme: dark) {
  .agent-chip--live {
    background: rgba(54, 179, 126, 0.16);
    color: #6ee7b7;
    border-color: rgba(54, 179, 126, 0.3);
  }
  .agent-chip--suspended {
    background: rgba(226, 178, 3, 0.16);
    color: #f4d35e;
  }
  .agent-chip--dead {
    background: rgba(107, 119, 140, 0.18);
    color: #9aa3b2;
  }
}
</style>
