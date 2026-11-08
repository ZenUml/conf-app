<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ReviewGroup, ReviewGroupPreparation } from '@zenuml/pr-panel-shared'
import { PanelPort } from '../../src/bridge/port'
import type { HubStatusMessage } from '../../src/bridge/messages'

const port = new PanelPort()
const group = ref<ReviewGroup | null>(null)
const preparation = ref<ReviewGroupPreparation | null>(null)
const status = ref<HubStatusMessage>({ state: 'disabled' })
const remaining = computed(() => group.value?.items.filter((item) => item.outcome === 'pending').length ?? 0)

onMounted(() => {
  port.onStatus((value) => { status.value = value })
  port.onFrame((frame) => {
    if (frame.type === 'group') { group.value = frame.group; preparation.value = frame.preparation }
  })
  port.connect()
})
onBeforeUnmount(() => port.disconnect())

function continueRound() { port.post({ kind: 'continueGroup' }); window.close() }
function openOptions() { port.post({ kind: 'openOptions' }); window.close() }
</script>

<template>
  <main>
    <div class="eyebrow">ZENUML · PR REVIEW</div>
    <h1 v-if="group">{{ group.product }}</h1>
    <h1 v-else>PR review</h1>
    <p v-if="preparation?.error" class="error">New round failed: {{ preparation.error }}</p>
    <p v-else-if="preparation">Preparing a new round. The previous round remains available.</p>
    <p v-if="group?.status === 'ready'">{{ remaining }} pull request{{ remaining === 1 ? '' : 's' }} remaining in this round.</p>
    <p v-else-if="group?.status === 'completed'">This round is complete.</p>
    <p v-else-if="group?.status === 'zero'">No pull requests matched this request.</p>
    <p v-else-if="!preparation">Ask your agent to prepare a PR review round.</p>
    <p v-if="status.state !== 'connected'" class="offline">Hub {{ status.state === 'disabled' ? 'access is disabled' : 'is offline' }}. Saved round remains readable.</p>
    <button v-if="remaining > 0" class="primary" type="button" @click="continueRound">Continue this round</button>
    <button type="button" @click="openOptions">Connection settings</button>
  </main>
</template>

<style>
body { margin: 0; color: #1f2328; background: #fff; font: 13px/1.45 system-ui, sans-serif; }
main { box-sizing: border-box; width: 320px; padding: 20px; }
.eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .1em; color: #59636e; }
h1 { margin: 7px 0 10px; font-size: 18px; line-height: 1.25; }
p { margin: 8px 0 14px; color: #59636e; }
.error { color: #b42318; }
.offline { padding: 8px 10px; border-radius: 6px; background: #fff8c5; color: #7d4e00; }
button { display: block; width: 100%; margin-top: 8px; padding: 8px 10px; border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa; color: #1f2328; text-align: center; font: inherit; cursor: pointer; }
button.primary { background: #0969da; border-color: #0969da; color: #fff; font-weight: 600; }
</style>
