<template>
  <!-- Rail status header (design contract §Region→component: AgentStatusHeader):
       agent avatar (Sparkles) + client name + subline + LiveBadge. The avatar
       tints with the session state (blue active/thinking, amber suspended,
       gray closed) to echo the badge without repeating its text. -->
  <div class="agent-status-header" data-testid="agent-link-status-header">
    <span class="agent-status-header__avatar" :class="avatarClass" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
      </svg>
    </span>
    <div class="agent-status-header__meta">
      <div class="agent-status-header__name" data-testid="agent-link-status-header-name">{{ displayName }}</div>
      <div class="agent-status-header__sub">{{ subline }}</div>
    </div>
    <LiveBadge :state="state" :thinking="thinking" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import LiveBadge from './LiveBadge.vue'
import type { AgentLinkClientState } from '@/composables/agentLink/agentLinkState'

const props = withDefaults(
  defineProps<{
    state: AgentLinkClientState
    // orthogonal "op in flight" axis (Track F) — drives the blue "Working" badge
    thinking?: boolean
    // Connected agent client name; falls back to the generic label.
    clientName?: string
    diagramTitle?: string
  }>(),
  { thinking: false, clientName: '', diagramTitle: '' }
)

const displayName = computed(() => props.clientName?.trim() || 'Connected agent')

const subline = computed(() => {
  // Active idle → capability subline; every other state → what it's bound to.
  if (props.state === 'connected') return 'Connected · reads & edits'
  const title = props.diagramTitle?.trim()
  return title ? `Linked to ${title}` : 'Linked to this diagram'
})

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
}
</style>
