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
    <span class="agent-chip__dot" aria-hidden="true"></span>

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
    <template v-else-if="variant === 'suspended'">Connecting</template>
    <template v-else-if="variant === 'expired'">Expired</template>
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

const variant = computed<'live' | 'suspended' | 'dead' | 'expired' | null>(() => {
  switch (props.state) {
    case 'connected':
      return 'live'
    case 'suspended':
      return 'suspended'
    case 'closed':
      return 'dead'
    // #314: the client-side TTL watchdog moves a stale session here — the
    // chip must leave the green "live" look instead of staying pinned on it
    // with a dead "0:00" countdown forever.
    case 'expired':
      return 'expired'
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
.agent-chip--suspended .agent-chip__dot {
  background: #c4761f;
  animation: agent-chip-pulse 1.6s ease-in-out infinite;
}

.agent-chip--dead {
  background: #f1f2f4;
  color: #6b778c;
}
.agent-chip--dead .agent-chip__dot {
  background: #97a0af;
}

/* #314: same muted gray treatment as --dead — a TTL lapse is a terminal,
   non-live state too, just with its own "Expired" copy. */
.agent-chip--expired {
  background: #f1f2f4;
  color: #6b778c;
}
.agent-chip--expired .agent-chip__dot {
  background: #97a0af;
}

@keyframes agent-chip-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .agent-chip--suspended .agent-chip__dot {
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
  .agent-chip--expired {
    background: rgba(107, 119, 140, 0.18);
    color: #9aa3b2;
  }
}
</style>
