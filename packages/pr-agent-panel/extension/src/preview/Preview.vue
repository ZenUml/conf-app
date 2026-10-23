<script setup lang="ts">
import { reactive } from 'vue'
import AgentPanel from '../ui/AgentPanel.vue'
import ReviewList from '../ui/ReviewList.vue'
import { REVIEWS, STATES, type PreviewState } from './fixtures'

// Each card keeps its own copy so clicks (collapse, preferences, send) work locally.
const cards = reactive(STATES.map((s) => ({ ...s, prefs: { ...s.prefs }, messages: [...s.messages] })))
const reviewOf = (s: PreviewState) => REVIEWS.find((r) => r.prNumber === s.reviewFor) ?? null
function send(card: (typeof cards)[number], text: string) {
  card.messages.push({ id: `local-${card.messages.length}`, role: 'user', text, status: 'queued' })
}
</script>

<template>
  <main class="pv">
    <header class="pv-head">
      <h1>ZenUML Agent Panel · reference states</h1>
      <p>The ten states of Figma 184:6368, rendered by the real components with fixture data. Compare against 184-5402 / 184-5446 / 184-6368.</p>
    </header>
    <div class="pv-grid">
      <section v-for="card in cards" :key="card.id" class="pv-card" :class="{ 'pv-card-wide': card.list }">
        <h2>{{ card.id }} · {{ card.title }}</h2>
        <p>{{ card.note }}</p>
        <div class="pv-stage">
          <div v-if="card.list" class="pv-list"><ReviewList :items="REVIEWS" :current-pr-number="card.pr?.number ?? null" /></div>
          <div v-else class="pv-page"><div class="pv-line" v-for="n in 6" :key="n"></div></div>
          <AgentPanel
            :connection="card.connection"
            :task="card.task"
            :pr="card.pr"
            :pr-state="card.pr?.number === 888 ? 'draft' : 'open'"
            :review="reviewOf(card)"
            :findings-count="card.reviewFor ? 3 : null"
            :messages="card.messages"
            :prefs="card.prefs"
            @toggle-collapsed="card.prefs.panelCollapsed = !card.prefs.panelCollapsed"
            @toggle-prefs="card.prefs.preferencesHidden = !card.prefs.preferencesHidden"
            @set-mcp-access="(v) => (card.prefs.mcpAccess = v)"
            @activate="card.connection = 'active'"
            @send="(t) => send(card, t)"
          />
        </div>
      </section>
    </div>
  </main>
</template>

<style>
body { margin: 0; background: #f6f8fa; color: #1f2328; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.pv { padding: 24px; }
.pv-head h1 { font-size: 20px; margin: 0 0 4px; }
.pv-head p { margin: 0 0 20px; color: #59636e; }
.pv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 20px; }
.pv-card { background: #fff; border: 1px solid #d1d9e0; border-radius: 8px; padding: 12px; }
.pv-card-wide { grid-column: span 2; }
.pv-card h2 { font-size: 14px; margin: 0; }
.pv-card > p { margin: 0 0 8px; color: #59636e; font-size: 12px; }
/* transform makes this box the containing block for the panel's position: fixed */
.pv-stage { position: relative; height: 640px; overflow: hidden; border: 1px solid #d8dee4; transform: translateZ(0); display: flex; background: #fff; }
.pv-list { width: 320px; flex: 0 0 320px; overflow-y: auto; }
.pv-page { flex: 1; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
.pv-line { height: 10px; background: #eef1f4; border-radius: 4px; }
.pv-line:nth-child(odd) { width: 70%; }
/* the panel's max-height uses 100vh; inside a 640px card cap it to the card */
.pv-stage .tp-panel { max-height: calc(100% - 48px); }
</style>
