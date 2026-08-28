<template>
  <!-- Terminal / rejection centered notice (design contract §Region→component:
       SessionNotice). Three variants off the FSM's terminal + mint-rejection
       branches. All copy is verbatim from the design contract string table. -->
  <div class="agent-notice" :class="`agent-notice--${variant}`" data-testid="agent-link-notice">
    <span class="agent-notice__icon" :class="iconClass" aria-hidden="true">
      <!-- rejected → lock; closed/expired → signal-slash -->
      <svg v-if="variant === 'rejected'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="m3 3 8.735 8.735m0 0a.374.374 0 1 1 .53.53m-.53-.53.53.53m0 0L21 21M14.652 9.348a3.75 3.75 0 0 1 0 5.304m2.121-7.425a6.75 6.75 0 0 1 0 9.546m2.121-11.667c3.808 3.807 3.808 9.98 0 13.788m-9.546-4.242a3.733 3.733 0 0 1-1.06-2.122m-1.061 4.243a6.75 6.75 0 0 1-1.625-6.929m-.496 9.05c-3.068-3.067-3.664-7.67-1.79-11.334M12 12h.008v.008H12V12Z" />
      </svg>
    </span>
    <div class="agent-notice__title" data-testid="agent-link-notice-title">{{ title }}</div>
    <div class="agent-notice__sub">{{ subline }}</div>

    <!-- One primary action per terminal state. -->
    <div v-if="variant === 'rejected'" class="agent-notice__actions">
      <button
        type="button"
        class="agent-notice__btn agent-notice__btn--primary"
        data-testid="agent-link-notice-revoke-btn"
        @click="emit('revoke')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
        Connect another AI agent
      </button>
    </div>

    <!-- idle / closed / expired / failed: one state-specific start action. -->
    <div v-else class="agent-notice__actions">
      <button
        type="button"
        class="agent-notice__btn agent-notice__btn--primary agent-notice__btn--block"
        data-testid="agent-link-reconnect-btn"
        @click="emit('reconnect')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
        </svg>
        {{ actionLabel }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    // 'closed' = explicit Disconnect; 'expired' = TTL lapse; 'rejected' =
    // a second link attempt on an already-bound diagram (mint 409);
    // 'failed' = the session mint failed for any other reason.
    variant?: 'idle' | 'closed' | 'expired' | 'rejected' | 'failed'
    diagramTitle?: string
    // Amendment D: absolute ms epoch when the existing lock on an
    // already-linked diagram releases (mint 409's lockExpiresAt), or
    // null/undefined when unknown. Only rendered as a countdown for the
    // 'rejected' variant, and only when it's actually still in the future —
    // never a fabricated/stale time.
    lockExpiresAt?: number | null
  }>(),
  { variant: 'closed', diagramTitle: '', lockExpiresAt: null }
)

const emit = defineEmits<{
  (e: 'reconnect'): void
  (e: 'revoke'): void
  (e: 'cancel'): void
}>()

const title = computed(() => {
  switch (props.variant) {
    case 'idle':
      return 'Connect'
    case 'expired':
      return 'Connection expired'
    case 'rejected':
      return 'This diagram is already linked'
    case 'failed':
      return 'Could not start Agent Link'
    default:
      return 'Disconnected'
  }
})

const subline = computed(() => {
  if (props.variant === 'rejected') {
    // Amendment D: only show a countdown when we actually know the lock's
    // release time AND it's still in the future — never a fabricated or
    // stale ("0 min" / negative) time.
    if (typeof props.lockExpiresAt === 'number' && props.lockExpiresAt > Date.now()) {
      const minutesRemaining = Math.ceil((props.lockExpiresAt - Date.now()) / 60000)
      return `Another AI agent has this link for about ${minutesRemaining} more min. Connecting another agent will end that link.`
    }
    return 'Connecting another AI agent will end the current link. Your diagram is saved.'
  }
  if (props.variant === 'idle') {
    return 'Start a connection to edit this diagram with your AI assistant.'
  }
  if (props.variant === 'failed') {
    return 'Your diagram is unchanged. Try creating a new pairing.'
  }
  if (props.variant === 'expired') {
    return 'Start a new connection when you are ready.'
  }
  return 'Start a new connection when you are ready.'
})

const actionLabel = computed(() => {
  switch (props.variant) {
    case 'idle':
      return 'Connect'
    case 'expired':
      return 'Connect'
    case 'failed':
      return 'Try again'
    default:
      return 'Connect'
  }
})

const iconClass = computed(() =>
  props.variant === 'rejected' ? 'agent-notice__icon--lock' : 'agent-notice__icon--gray'
)
</script>

<style scoped>
.agent-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 22px 18px;
  gap: 4px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.agent-notice__icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
}
.agent-notice__icon svg {
  width: 24px;
  height: 24px;
}
.agent-notice__icon--gray {
  background: #f1f2f4;
  color: #6b778c;
}
.agent-notice__icon--lock {
  background: #fbf3d6;
  color: #8a6d00;
}
.agent-notice__title {
  font-size: 14px;
  font-weight: 600;
  color: #172b4d;
}
.agent-notice__sub {
  font-size: 12px;
  color: #6b778c;
  max-width: 240px;
  line-height: 1.45;
}
.agent-notice__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-top: 14px;
}
.agent-notice__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 6px;
  border: 1px solid transparent;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 200ms ease, border-color 200ms ease;
}
.agent-notice__btn svg {
  width: 15px;
  height: 15px;
}
.agent-notice__btn--primary {
  background: #2563eb;
  color: #fff;
}
.agent-notice__btn--primary:hover {
  background: #1d4ed8;
}
.agent-notice__btn--ghost {
  background: transparent;
  color: #172b4d;
  border-color: #e5e7eb;
  font-weight: 500;
}
.agent-notice__btn--ghost:hover {
  background: #f7f8fa;
}
.agent-notice__btn--block {
  width: 100%;
}
@media (prefers-color-scheme: dark) {
  .agent-notice__title {
    color: #e6e8ee;
  }
  .agent-notice__sub {
    color: #9aa3b2;
  }
  .agent-notice__btn--ghost {
    color: #e6e8ee;
    border-color: #3a3f4b;
  }
}
</style>
