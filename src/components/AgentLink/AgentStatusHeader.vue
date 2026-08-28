<template>
  <!-- Rail status header (design contract §Region→component: AgentStatusHeader):
       agent avatar (Sparkles) + client name + subline + LiveBadge. The avatar
       tints with the session state (blue active/thinking, amber suspended,
       gray closed) to echo the badge without repeating its text. -->
  <div class="agent-status-header" data-testid="agent-link-status-header">
    <span
      class="agent-status-header__avatar"
      :class="avatarClass"
      :style="brandColorStyle"
      aria-hidden="true"
      :data-client-brand="brandIcon?.label ?? 'generic'"
    >
      <svg v-if="brandIcon" viewBox="0 0 24 24" fill="currentColor" data-testid="agent-link-client-brand-icon">
        <path :d="brandIcon.icon.path" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" data-testid="agent-link-client-generic-icon">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
      </svg>
    </span>
    <div class="agent-status-header__meta">
      <div class="agent-status-header__name" data-testid="agent-link-status-header-name">{{ displayName }}</div>
      <div class="agent-status-header__sub">{{ subline }}</div>
    </div>
    <LiveBadge :state="state" :thinking="thinking" :last-activity-at="lastActivityAt" />
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
    // orthogonal "op in flight" axis (Track F) — drives the blue "Working" badge
    thinking?: boolean
    // Connected agent client name; falls back to the generic label.
    clientName?: string
    diagramTitle?: string
    lastActivityAt?: number | null
  }>(),
  { thinking: false, clientName: '', diagramTitle: '', lastActivityAt: null }
)

const RECOGNIZED_CLIENT_LABELS = new Set(['Codex', 'Claude Code', 'Cursor'])
const displayName = computed(() => {
  const label = props.clientName?.trim()
  return label && RECOGNIZED_CLIENT_LABELS.has(label) ? label : 'Connected'
})
const brandIcon = computed(() => getLiveClientBrand(displayName.value))
const brandColorStyle = computed(() =>
  brandIcon.value ? { color: `#${brandIcon.value.icon.hex}` } : undefined
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
  // Active idle → capability subline; every other state → what it's bound to.
  if (props.state === 'connected') {
    if (props.thinking) return 'Connected · reads & edits'
    if (props.lastActivityAt === null || props.lastActivityAt === undefined) return 'Connected · reads & edits'
    if (agentActive.value) return 'Connected · agent active'
    return `Connected · agent active · ${formatActivityAge(nowMs.value - props.lastActivityAt)} ago`
  }
  const title = props.diagramTitle?.trim()
  return title ? `Linked to ${title}` : 'Linked to this diagram'
})

function formatActivityAge(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000))
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`
  return `${seconds}s`
}

const avatarClass = computed(() => {
  switch (props.state) {
    case 'suspended':
      return 'agent-status-header__avatar--amber'
    case 'closed':
      return 'agent-status-header__avatar--gray'
    default:
      return 'agent-status-header__avatar--blue'
  }
})
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
.agent-status-header__avatar svg {
  width: 20px;
  height: 20px;
}
.agent-status-header__avatar--blue {
  background: #eff4ff;
  color: #2563eb;
}
.agent-status-header__avatar--amber {
  background: #fbf3d6;
  color: #8a6d00;
}
.agent-status-header__avatar--gray {
  background: #f1f2f4;
  color: #6b778c;
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
