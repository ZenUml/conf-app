<template>
  <section ref="root" class="ih-banner" aria-label="Add a diagram or API spec to this page">
    <button class="ih-close" type="button" aria-label="Dismiss" @click="emit('dismiss')">
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>

    <div class="ih-howto">
      <h2 class="ih-headline">
        Add a <span class="ih-headline-accent">diagram or API spec</span><br />to this page.
      </h2>
      <ol class="ih-steps">
        <li class="ih-step">
          <span class="ih-step-num">1</span>
          <span>Type <kbd class="ih-key" data-testid="insert-hint-command">{{ current.command }}</kbd> in the page</span>
        </li>
        <li class="ih-step">
          <span class="ih-step-num">2</span>
          <span>Press <kbd class="ih-key">Enter ↵</kbd></span>
        </li>
      </ol>
    </div>

    <div class="ih-divider" aria-hidden="true" />

    <div
      class="ih-tabs"
      role="tablist"
      aria-orientation="vertical"
      aria-label="Diagram type"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
      @keydown="onKeydown"
    >
      <button
        v-for="(tab, i) in tabs"
        :id="`ih-tab-${tab.id}`"
        :key="tab.id"
        ref="tabEls"
        class="ih-tab"
        :class="{ 'ih-tab-selected': i === selected }"
        type="button"
        role="tab"
        :aria-selected="i === selected"
        :aria-controls="`ih-panel-${tab.id}`"
        :tabindex="i === selected ? 0 : -1"
        @click="select(i, 'click')"
      >
        <img class="ih-logo" :src="logos[tab.id]" width="24" height="24" alt="" aria-hidden="true" />
        <span class="ih-tab-text">
          <span class="ih-tab-title">{{ tab.title }}</span>
          <span v-if="i === selected" class="ih-tab-desc">{{ tab.description }}</span>
        </span>
        <span
          v-if="i === selected"
          class="ih-progress"
          data-testid="insert-hint-progress"
          :style="{ width: `${Math.round(progress * 100)}%` }"
        />
      </button>
    </div>

    <div class="ih-gap" aria-hidden="true" />

    <div
      :id="`ih-panel-${current.id}`"
      class="ih-card"
      role="tabpanel"
      :aria-labelledby="`ih-tab-${current.id}`"
    >
      <svg
        :key="`${current.id}-${buildKey}`"
        class="ih-preview"
        :class="{ 'ih-animate': animate }"
        viewBox="0 0 466 144"
        width="466"
        height="144"
        role="img"
        :aria-label="previewLabel"
      >
        <defs>
          <marker id="ih-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0L8 4 0 8z" fill="#6B778C" />
          </marker>
        </defs>

        <g v-if="current.id === 'mermaid'" class="ih-mermaid">
          <g class="ih-el" style="--i: 0"><rect x="22" y="55" width="80" height="34" rx="4" /><text x="62" y="76">Request</text></g>
          <path class="ih-el ih-edge" style="--i: 1" d="M102 72H132" marker-end="url(#ih-arrow)" />
          <g class="ih-el" style="--i: 2"><rect x="134" y="55" width="80" height="34" rx="4" /><text x="174" y="76">Review</text></g>
          <path class="ih-el ih-edge" style="--i: 3" d="M214 72H244" marker-end="url(#ih-arrow)" />
          <g class="ih-el" style="--i: 4"><path d="M290 40L336 72 290 104 244 72z" /><text x="290" y="76">Approved?</text></g>
          <path class="ih-el ih-edge" style="--i: 5" d="M336 72H372" marker-end="url(#ih-arrow)" />
          <g class="ih-el" style="--i: 6"><rect x="374" y="55" width="72" height="34" rx="4" /><text x="410" y="76">Publish</text></g>
        </g>

        <g v-else-if="current.id === 'drawio'" class="ih-drawio">
          <defs>
            <pattern id="ih-grid-minor" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M10 0H0V10" fill="none" stroke="#F0F0F0" />
            </pattern>
            <pattern id="ih-grid-major" width="40" height="40" patternUnits="userSpaceOnUse">
              <rect width="40" height="40" fill="url(#ih-grid-minor)" />
              <path d="M40 0H0V40" fill="none" stroke="#E0E0E0" />
            </pattern>
            <marker id="ih-classic" viewBox="0 0 7 8" refX="6" refY="4" markerWidth="7" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0 0.5L6.5 4 0 7.5z" fill="#000" />
            </marker>
          </defs>
          <rect class="ih-grid" x="1" y="1" width="464" height="142" fill="url(#ih-grid-major)" />
          <g class="ih-el" style="--i: 0"><rect class="ih-dio-blue" x="15" y="56" width="80" height="34" rx="6" /><text x="55" y="77">Browser</text></g>
          <path class="ih-el ih-dio-edge" style="--i: 1" d="M95 73H122" marker-end="url(#ih-classic)" />
          <g class="ih-el" style="--i: 2"><rect class="ih-dio-green" x="123" y="56" width="100" height="34" rx="6" /><text x="173" y="77">API Gateway</text></g>
          <g class="ih-el ih-cloud" style="--i: 3">
            <rect x="251" y="31" width="194" height="80" />
            <text x="259" y="43">Cloud</text>
          </g>
          <path class="ih-el ih-dio-edge" style="--i: 4" d="M223 73H262" marker-end="url(#ih-classic)" />
          <g class="ih-el" style="--i: 5"><rect class="ih-dio-orange" x="263" y="56" width="70" height="34" rx="6" /><text x="298" y="77">Service</text></g>
          <path class="ih-el ih-dio-edge" style="--i: 6" d="M333 73H360" marker-end="url(#ih-classic)" />
          <g class="ih-el ih-db" style="--i: 7">
            <path d="M361 59c0-4.4 16.1-8 36-8s36 3.6 36 8v28c0 4.4-16.1 8-36 8s-36-3.6-36-8V59z" />
            <path d="M361 59c0 4.4 16.1 8 36 8s36-3.6 36-8" fill="none" />
            <text x="397" y="83">Database</text>
          </g>
          <g class="ih-el ih-select" style="--i: 8">
            <rect class="ih-select-outline" x="121" y="54" width="104" height="38" />
            <rect v-for="(h, n) in handles" :key="n" class="ih-handle" :x="h[0]" :y="h[1]" width="6" height="6" />
          </g>
        </g>

        <g v-else class="ih-openapi">
          <g class="ih-el" style="--i: 0">
            <text class="ih-api-title" x="22" y="20">Pet Store API <tspan class="ih-api-version">v1.0</tspan></text>
          </g>
          <g v-for="(op, k) in operations" :key="op.method" class="ih-el ih-op" :class="`ih-op-${op.method.toLowerCase()}`" :style="{ '--i': k + 1 }">
            <rect class="ih-op-row" x="22" :y="30 + k * 30" width="422" height="24" rx="4" />
            <rect class="ih-op-badge" x="27" :y="33 + k * 30" width="58" height="18" rx="3" />
            <text class="ih-op-method" x="56" :y="46 + k * 30">{{ op.method }}</text>
            <text class="ih-op-path" x="96" :y="46 + k * 30">{{ op.path }}</text>
            <text class="ih-op-summary" x="436" :y="46 + k * 30">{{ op.summary }}</text>
          </g>
        </g>
      </svg>

      <button class="ih-replay" type="button" @click="replay">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M10 6a4 4 0 1 1-1.2-2.85M10 1.5v2.5H7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        Replay
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  INSERT_HINT_TABS,
  ROTATE_STEP_MS,
  nextAutoIndex,
  type InsertHintSwitchSource,
  type InsertHintTabId,
} from './insertHintTabs';
import mermaidLogo from './logos/mermaid.svg';
import drawioLogo from './logos/drawio.svg';
import swaggerLogo from './logos/swagger.svg';

/**
 * H.1 insert hint: tells a person how to add a diagram or API spec to the page
 * and shows what each kind looks like. The tabs rotate once on their own
 * (Mermaid, draw.io, Swagger, back to Mermaid) and then stop.
 *
 * This component only renders and reports. It sends no analytics and makes no
 * Forge calls; the host wires `shown`, `tab-change`, `replay` and `dismiss`.
 */
const props = withDefaults(
  defineProps<{
    /** Run the one automatic pass through the tabs. */
    autoRotate?: boolean;
    /** Override `prefers-reduced-motion` (Storybook and tests). */
    reducedMotion?: boolean;
    /** Tab shown first. */
    initialTab?: InsertHintTabId;
  }>(),
  { autoRotate: true, reducedMotion: undefined, initialTab: 'mermaid' },
);

const emit = defineEmits<{
  shown: [];
  'tab-change': [payload: { tab: InsertHintTabId; source: InsertHintSwitchSource }];
  replay: [payload: { tab: InsertHintTabId }];
  dismiss: [];
}>();

const tabs = INSERT_HINT_TABS;
const logos: Record<InsertHintTabId, string> = { mermaid: mermaidLogo, drawio: drawioLogo, swagger: swaggerLogo };
// draw.io selection handles around "API Gateway": corners and edge midpoints.
const handles = [
  [118, 51], [170, 51], [222, 51],
  [118, 70], [222, 70],
  [118, 89], [170, 89], [222, 89],
];
const operations = [
  { method: 'GET', path: '/pets', summary: 'List all pets' },
  { method: 'POST', path: '/pets', summary: 'Add a pet' },
  { method: 'DELETE', path: '/pets/{id}', summary: 'Delete a pet' },
];

const startIndex = Math.max(0, tabs.findIndex((t) => t.id === props.initialTab));
const selected = ref(startIndex);
const current = computed(() => tabs[selected.value]);
const tabEls = ref<HTMLButtonElement[]>([]);

const prefersReduced = (() => {
  if (props.reducedMotion !== undefined) return props.reducedMotion;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
})();
const animate = !prefersReduced;

/** Bumped to restart the preview build animation. */
const buildKey = ref(0);

// Rotation state. `progress` is the share of the current step that has run.
const rotating = ref(false);
const hovered = ref(false);
// Empty while a pass is pending; full at rest.
const progress = ref(props.autoRotate && !prefersReduced ? 0 : 1);
let stepsDone = 0;
let elapsedMs = 0;
let lastTick = 0;
let frame = 0;
let observer: IntersectionObserver | null = null;

const previewLabel = computed(() => `${current.value.title} preview`);

function tick() {
  if (!rotating.value) return;
  // Read the clock here rather than trusting the rAF timestamp, whose origin
  // can differ from performance.now().
  const now = performance.now();
  if (!hovered.value) elapsedMs += now - lastTick;
  lastTick = now;
  progress.value = Math.min(1, elapsedMs / ROTATE_STEP_MS);
  if (elapsedMs >= ROTATE_STEP_MS) {
    stepsDone += 1;
    const next = nextAutoIndex(selected.value, stepsDone);
    if (next === null) {
      stopRotation();
      return;
    }
    selected.value = next;
    buildKey.value += 1;
    emit('tab-change', { tab: tabs[next].id, source: 'auto' });
    elapsedMs = 0;
    progress.value = 0;
    if (stepsDone >= tabs.length) {
      // Back on the first tab: the pass is over.
      stopRotation();
      return;
    }
  }
  frame = requestAnimationFrame(tick);
}

function startRotation() {
  if (rotating.value || !props.autoRotate || prefersReduced || stepsDone > 0) return;
  rotating.value = true;
  elapsedMs = 0;
  progress.value = 0;
  lastTick = performance.now();
  frame = requestAnimationFrame(tick);
}

function stopRotation() {
  rotating.value = false;
  cancelAnimationFrame(frame);
  progress.value = 1;
  stepsDone = tabs.length;
}

function select(i: number, source: InsertHintSwitchSource) {
  stopRotation();
  if (i === selected.value) return;
  selected.value = i;
  buildKey.value += 1;
  emit('tab-change', { tab: tabs[i].id, source });
}

function onKeydown(e: KeyboardEvent) {
  const last = tabs.length - 1;
  let target: number | null = null;
  if (e.key === 'ArrowDown') target = selected.value === last ? 0 : selected.value + 1;
  else if (e.key === 'ArrowUp') target = selected.value === 0 ? last : selected.value - 1;
  else if (e.key === 'Home') target = 0;
  else if (e.key === 'End') target = last;
  if (target === null) return;
  e.preventDefault();
  select(target, 'keyboard');
  tabEls.value[target]?.focus();
}

function replay() {
  buildKey.value += 1;
  emit('replay', { tab: current.value.id });
}

// A rotating tab that has not been seen is wasted, so the pass waits until the
// banner is on screen.
const root = ref<HTMLElement | null>(null);
onMounted(() => {
  emit('shown');
  if (typeof IntersectionObserver === 'undefined' || !root.value) {
    startRotation();
    return;
  }
  observer = new IntersectionObserver((entries) => {
    if (entries.some((en) => en.isIntersecting)) {
      startRotation();
      observer?.disconnect();
      observer = null;
    }
  });
  observer.observe(root.value);
});

watch(
  () => props.autoRotate,
  (on) => {
    if (!on) stopRotation();
  },
);

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  observer?.disconnect();
});
</script>

<style scoped>
.ih-banner {
  position: relative;
  display: flex;
  align-items: stretch;
  box-sizing: border-box;
  width: 1120px;
  height: 176px;
  padding: 16px 20px;
  background: #ffffff;
  border: 1px solid rgba(9, 30, 66, 0.14);
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  color: #172b4d;
}

.ih-close {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: #44546f;
  cursor: pointer;
}
.ih-close:hover { background: rgba(9, 30, 66, 0.06); }

/* Left column: headline 48 + gap 14 + steps 58 = 120, centred in 144. */
.ih-howto {
  width: 330px;
  flex: none;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
}
.ih-headline {
  margin: 0;
  font-size: 20px;
  line-height: 24px;
  font-weight: 600;
  color: #172b4d;
}
.ih-headline-accent { color: #5e4db2; }

.ih-steps {
  position: relative;
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
/* Connector between the two numbers: 2 x 16. */
.ih-steps::before {
  content: '';
  position: absolute;
  left: 9px;
  top: 21px;
  width: 2px;
  height: 16px;
  background: rgba(9, 30, 66, 0.14);
}
.ih-step {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 21px;
  font-size: 14px;
  line-height: 20px;
}
.ih-step-num {
  width: 20px;
  height: 20px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #f1f2f4;
  color: #44546f;
  font-size: 11px;
  font-weight: 600;
}
.ih-key {
  display: inline-block;
  box-sizing: border-box;
  height: 22px;
  margin: 0 4px;
  padding: 0 6px;
  border: 1px solid rgba(9, 30, 66, 0.14);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: #ffffff;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 19px;
  color: #172b4d;
}

.ih-divider {
  width: 24px;
  flex: none;
  background: linear-gradient(rgba(9, 30, 66, 0.14), rgba(9, 30, 66, 0.14)) center / 1px 100% no-repeat;
}
.ih-gap { width: 24px; flex: none; }

/* Tab list: selected 56 + two rows of 40 + two gaps of 4 = 144. */
.ih-tabs {
  width: 236px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-radius: 8px;
  outline: none;
}
.ih-tabs:focus-within {
  box-shadow: 0 0 0 2px #388bff;
}
.ih-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
  height: 40px;
  padding: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  font: inherit;
  color: #172b4d;
  cursor: pointer;
  transition: height 150ms ease-out, background-color 150ms ease-out;
}
.ih-tab:hover { background: rgba(9, 30, 66, 0.06); }
.ih-tab:focus-visible { outline: none; }
.ih-tab-selected,
.ih-tab-selected:hover {
  height: 56px;
  background: #e9f2ff;
}
.ih-logo { width: 24px; height: 24px; flex: none; display: block; }
.ih-tab-text { display: flex; flex-direction: column; min-width: 0; }
.ih-tab-title { font-size: 14px; line-height: 20px; font-weight: 500; }
.ih-tab-selected .ih-tab-title { font-weight: 600; color: #0c66e4; }
.ih-tab-desc { font-size: 12px; line-height: 16px; color: #44546f; }

/* 2 px bar, inset 8, on a 220 px track. */
.ih-progress {
  position: absolute;
  left: 8px;
  bottom: 0;
  max-width: 220px;
  height: 2px;
  border-radius: 1px;
  background: #0c66e4;
}

.ih-card {
  position: relative;
  width: 466px;
  height: 144px;
  flex: none;
  box-sizing: border-box;
  border: 1px solid rgba(9, 30, 66, 0.14);
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}
.ih-preview {
  position: absolute;
  inset: -1px;
  font-family: inherit;
}
.ih-preview text {
  font-size: 12px;
  text-anchor: middle;
  fill: #172b4d;
}
.ih-edge {
  fill: none;
  stroke: #6b778c;
  stroke-width: 1.2;
}

.ih-mermaid rect,
.ih-mermaid path:not(.ih-edge) {
  fill: #ececff;
  stroke: #9370db;
  stroke-width: 1;
}

.ih-drawio text { font-family: Helvetica, Arial, sans-serif; fill: #000; }
.ih-drawio rect:not(.ih-grid):not(.ih-handle):not(.ih-select-outline) { stroke-width: 1; }
.ih-dio-blue { fill: #dae8fc; stroke: #6c8ebf; }
.ih-dio-green { fill: #d5e8d4; stroke: #82b366; }
.ih-dio-orange { fill: #ffe6cc; stroke: #d79b00; }
.ih-dio-edge { fill: none; stroke: #000; stroke-width: 1; }
.ih-drawio .ih-db path { fill: #fff2cc; stroke: #d6b656; stroke-width: 1; }
.ih-drawio .ih-db path + path { fill: none; }
.ih-drawio .ih-cloud rect {
  fill: none;
  stroke: #d79b00;
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}
.ih-drawio .ih-cloud text {
  text-anchor: start;
  font-size: 10px;
  font-weight: 700;
  fill: #d79b00;
}
.ih-select-outline { fill: none; stroke: #00a8ff; stroke-width: 1; stroke-dasharray: 3 3; }
.ih-handle { fill: #00a8ff; stroke: #fff; stroke-width: 1; }

.ih-openapi .ih-api-title {
  text-anchor: start;
  font-weight: 600;
}
.ih-openapi .ih-api-version {
  font-weight: 400;
  fill: #6b778c;
}
.ih-op-row { stroke-width: 1; }
.ih-op-badge { stroke: none; }
.ih-op .ih-op-method { font-size: 11px; font-weight: 700; fill: #ffffff; }
.ih-op .ih-op-path {
  text-anchor: start;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.ih-op .ih-op-summary { text-anchor: end; font-size: 11px; fill: #44546f; }
.ih-op-get .ih-op-row { fill: #ebf3fb; stroke: #61affe; }
.ih-op-get .ih-op-badge { fill: #61affe; }
.ih-op-post .ih-op-row { fill: #e8f6f0; stroke: #49cc90; }
.ih-op-post .ih-op-badge { fill: #49cc90; }
.ih-op-delete .ih-op-row { fill: #feebeb; stroke: #f93e3e; }
.ih-op-delete .ih-op-badge { fill: #f93e3e; }

/* Build animation: each element fades in after the previous one. */
.ih-animate .ih-el {
  opacity: 0;
  animation: ih-build 260ms ease-out forwards;
  animation-delay: calc(var(--i) * 280ms);
}
@keyframes ih-build {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}

.ih-replay {
  position: absolute;
  right: 12px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  color: #6b778c;
  cursor: pointer;
}
.ih-replay:hover { color: #44546f; text-decoration: underline; }
</style>
