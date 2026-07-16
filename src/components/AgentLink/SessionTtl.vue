<template>
  <!-- Rail TTL meter (design contract §Region→component: SessionTtl). Renders
       nothing until we have a real expiry (the mint returns expiresInSec; a
       reattached/hydrated session has none, so the meter degrades gracefully
       to absent rather than showing a fake countdown). Amber under 120 s. -->
  <div
    v-if="remainingSeconds !== null"
    class="agent-ttl"
    :class="{ 'agent-ttl--warn': isWarn }"
    data-testid="agent-link-ttl"
  >
    <div class="agent-ttl__line">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="agent-ttl__icon">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
      Session expires in <b data-testid="agent-link-ttl-value">{{ formatted }}</b>
    </div>
    <div class="agent-ttl__bar">
      <div class="agent-ttl__fill" :style="{ width: fillPct + '%' }"></div>
    </div>
    <!-- The bar visibly refilling on each sliding-TTL bump (PR1 status bus)
         reads as a bug without this cue — spell out that it's intended. -->
    <div class="agent-ttl__hint">extends while your agent works</div>
  </div>
</template>

<script setup lang="ts">
// Self-contained 1-second ticker so the host (GenericViewer) can stay dumb and
// just hand down the absolute expiry instant. Design token: amber #E2B203
// warning under 120 s; success #36B37E fill otherwise.
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    // Absolute ms epoch when the token expires, or null when unknown.
    expiresAt: number | null
    // Full token lifetime in seconds — drives the bar's proportional fill.
    // Default 600 s = the 10-minute session TTL the connect prompt advertises.
    totalSeconds?: number
  }>(),
  { totalSeconds: 600 }
)

const WARN_THRESHOLD_SECONDS = 120

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
  () => props.expiresAt,
  (v) => {
    if (v === null || v === undefined) stopTicking()
    else startTicking()
  },
  { immediate: true }
)

onBeforeUnmount(stopTicking)

const remainingSeconds = computed<number | null>(() => {
  if (props.expiresAt === null || props.expiresAt === undefined) return null
  return Math.max(0, Math.ceil((props.expiresAt - nowMs.value) / 1000))
})

const isWarn = computed(
  () => remainingSeconds.value !== null && remainingSeconds.value < WARN_THRESHOLD_SECONDS
)

const formatted = computed(() => formatMmSs(remainingSeconds.value ?? 0))

const fillPct = computed(() => {
  if (remainingSeconds.value === null) return 0
  const total = props.totalSeconds > 0 ? props.totalSeconds : 600
  return Math.max(0, Math.min(100, (remainingSeconds.value / total) * 100))
})

// M:SS with a tabular-friendly single-minute digit (matches the previews' 8:42).
function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
</script>

<style scoped>
.agent-ttl {
  margin-bottom: 16px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.agent-ttl__line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b778c;
  margin-bottom: 6px;
}
.agent-ttl__icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}
.agent-ttl__line b {
  color: #172b4d;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.agent-ttl--warn .agent-ttl__line b {
  color: #8a6d00;
}
.agent-ttl__bar {
  height: 4px;
  border-radius: 2px;
  background: #edeff2;
  overflow: hidden;
}
.agent-ttl__fill {
  height: 100%;
  border-radius: 2px;
  background: #36b37e;
  transition: width 1s linear;
}
.agent-ttl--warn .agent-ttl__fill {
  background: #e2b203;
}
.agent-ttl__hint {
  margin-top: 4px;
  font-size: 11px;
  color: #97a0af;
}
@media (prefers-reduced-motion: reduce) {
  .agent-ttl__fill {
    transition: none;
  }
}
@media (prefers-color-scheme: dark) {
  .agent-ttl__line {
    color: #9aa3b2;
  }
  .agent-ttl__line b {
    color: #e6e8ee;
  }
  .agent-ttl__bar {
    background: #3a3f4b;
  }
  .agent-ttl__hint {
    color: #6b7280;
  }
}
</style>
