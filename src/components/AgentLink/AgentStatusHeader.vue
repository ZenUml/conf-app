<template>
  <!-- The connected client is the durable anchor. Automatic recovery changes
       only the small status signal; the client identity and rail body stay put. -->
  <div class="agent-status-header" data-testid="agent-link-status-header">
    <span
      class="agent-status-header__avatar agent-status-header__avatar--blue"
      :style="brandColorStyle"
      aria-hidden="true"
      :data-client-brand="brandIcon?.label ?? 'generic'"
    >
      <svg v-if="brandIcon?.icon" viewBox="0 0 24 24" fill="currentColor" data-testid="agent-link-client-brand-icon">
        <path :d="brandIcon.icon.path" />
      </svg>
      <img
        v-else-if="brandIcon?.assetUrl"
        :src="brandIcon.assetUrl"
        alt=""
        data-testid="agent-link-client-brand-icon"
      />
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" data-testid="agent-link-client-generic-icon">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
      </svg>
    </span>
    <div class="agent-status-header__meta">
      <div class="agent-status-header__name" data-testid="agent-link-status-header-name">{{ displayName }}</div>
      <div class="agent-status-header__sub">{{ subline }}</div>
    </div>
    <LiveBadge :state="state" :last-activity-at="lastActivityAt" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LiveBadge from './LiveBadge.vue'
import type { AgentLinkClientState } from '@/composables/agentLink/agentLinkState'
import { ACTIVITY_LINGER_MS } from '@/composables/agentLink/useAgentLinkSession'
import { getLiveClientBrand } from './agentClientBrands'

const props = withDefaults(
  defineProps<{
    state: AgentLinkClientState
    // Orthogonal op-in-flight axis; reflected in the header subline while the
    // actual work remains the first timeline row.
    thinking?: boolean
    // Connected agent client name; falls back to the neutral label/glyph.
    clientName?: string
    lastActivityAt?: number | null
  }>(),
  { thinking: false, clientName: '', lastActivityAt: null }
)

const RECOGNIZED_CLIENT_LABELS = new Set(['Codex', 'Claude Code', 'Cursor'])
const displayName = computed(() => {
  const label = props.clientName?.trim()
  return label && RECOGNIZED_CLIENT_LABELS.has(label) ? label : 'AI assistant'
})
const brandIcon = computed(() => getLiveClientBrand(displayName.value))
const brandColorStyle = computed(() =>
  brandIcon.value?.icon ? { color: `#${brandIcon.value.icon.hex}` } : undefined
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

const subline = computed(() => {
  if (props.thinking) return 'Editing now'
  if (props.lastActivityAt === null || props.lastActivityAt === undefined) return 'Reads & edits'
  if (agentActive.value) return 'Active now'
  return `Active ${formatActivityAge(nowMs.value - props.lastActivityAt)} ago`
})

function formatActivityAge(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000))
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`
  return `${seconds}s`
}

</script>

<style scoped>
.agent-status-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.agent-status-header__avatar {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.agent-status-header__avatar svg,
.agent-status-header__avatar img {
  width: 20px;
  height: 20px;
}
.agent-status-header__avatar--blue {
  background: #eff4ff;
  color: #2563eb;
}
.agent-status-header__meta {
  flex: 1 1 auto;
  min-width: 0;
}
.agent-status-header__name {
  font-size: 14px;
  font-weight: 600;
  color: #172b4d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-status-header__sub {
  font-size: 12px;
  color: #6b778c;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (prefers-color-scheme: dark) {
  .agent-status-header__name {
    color: #e6e8ee;
  }
  .agent-status-header__sub {
    color: #9aa3b2;
  }
  .agent-status-header__avatar--blue {
    background: rgba(37, 99, 235, 0.2);
    color: #93b4ff;
  }
  .agent-status-header__avatar[data-client-brand="Cursor"] {
    color: #ffffff !important;
  }
}
</style>
