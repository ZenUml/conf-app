<template>
  <aside v-if="message" class="status" role="status" aria-live="polite" data-testid="fullscreen-recovery-status">
    <span>{{ message }}</span>
    <button v-if="snapshot.state === 'active' || snapshot.state === 'expired'" type="button" @click="$emit('continueRequest')">Continue request</button>
    <button v-if="snapshot.state === 'expired'" type="button" aria-label="Dismiss Fullscreen access notice" @click="$emit('dismiss')">Dismiss</button>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RecoverySnapshot } from '../../../shared/fullscreenRecovery'
import { fullLocalDate } from './recoveryPresentation'

const props = defineProps<{ snapshot: RecoverySnapshot }>()
defineEmits<{ (event: 'continueRequest'): void; (event: 'dismiss'): void }>()
const message = computed(() => {
  const snapshot = props.snapshot
  if (snapshot.state === 'notice' && snapshot.enforceAt) return `Fullscreen access will change on ${fullLocalDate(snapshot.enforceAt)}. Existing diagrams remain readable on the page.`
  if (snapshot.state === 'pending_activation') return 'Your 7 days of Fullscreen begin when the diagram first opens successfully.'
  if (snapshot.state === 'active' && snapshot.grant?.expiresAt) return `Temporary Fullscreen access ends ${fullLocalDate(snapshot.grant.expiresAt)}.`
  if (snapshot.state === 'expired' && snapshot.grant?.expiresAt) return `Temporary Fullscreen access ended ${fullLocalDate(snapshot.grant.expiresAt)}. This open view can continue; access is checked next time you open Fullscreen.`
  return ''
})
</script>

<style scoped>
.status { display: flex; align-items: center; gap: 12px; max-width: 680px; padding: 12px; color: var(--amber-12, #4f3422); background: var(--amber-2, #fefbe9); border-top: .5px solid var(--slate-6, #d9d9e0); border-bottom: .5px solid var(--slate-6, #d9d9e0); font: 14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.status span { flex: 1; }
.status button { min-height: 32px; padding: 5px 9px; border: .5px solid var(--slate-7, #cdced6); border-radius: 4px; background: var(--slate-3, #f0f0f3); color: var(--slate-12, #1c2024); font-family: inherit; font-size: 12px; line-height: 1.4; cursor: pointer; }
.status button:focus-visible { outline: 2px solid var(--indigo-8, #8da4ef); outline-offset: 3px; }
</style>
