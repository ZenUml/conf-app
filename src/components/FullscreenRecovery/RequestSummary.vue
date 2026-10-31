<template>
  <div v-if="snapshot.request" class="summary" aria-label="Fullscreen request summary">
    <dl>
      <dt>Request reference</dt><dd>{{ snapshot.request.id }}</dd>
      <dt>Original use</dt><dd>{{ snapshot.request.scenarios.map(code => scenarioLabels[code]).join(', ') }}</dd>
      <dt v-if="snapshot.request.note">Additional context</dt><dd v-if="snapshot.request.note">{{ snapshot.request.note }}</dd>
      <dt>Reply email</dt><dd>{{ snapshot.request.email }}</dd>
    </dl>
  </div>
</template>

<script setup lang="ts">
import type { RecoverySnapshot } from '../../../shared/fullscreenRecovery'
import { scenarioLabels } from './recoveryPresentation'
defineProps<{ snapshot: RecoverySnapshot }>()
</script>

<style scoped>
.summary { margin: 20px 0; padding: 12px 0; border-top: .5px solid var(--slate-6, #d9d9e0); border-bottom: .5px solid var(--slate-6, #d9d9e0); }
.summary dl { display: grid; grid-template-columns: 120px 1fr; column-gap: 14px; row-gap: 5px; margin: 0; }
.summary dt { color: var(--slate-11, #60646c); font-size: 12px; }
.summary dd { margin: 0; overflow-wrap: anywhere; }
</style>
