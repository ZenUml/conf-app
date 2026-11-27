<template>
  <dialog
    ref="dialog"
    class="inline-intro"
    aria-labelledby="mermaid-inline-intro-title"
    aria-describedby="mermaid-inline-intro-description"
    :data-phase="phase"
    @cancel.prevent="dismiss"
    @keydown.stop="onKeydown"
    @keypress.stop
    @keyup.stop
  >
    <div class="intro-content">
      <header class="intro-header">
        <span v-if="isSequence" class="intro-icon" aria-hidden="true"><PencilIcon /></span>
        <div>
          <h2 id="mermaid-inline-intro-title">{{ example.title }}</h2>
          <p id="mermaid-inline-intro-description">{{ example.description }}</p>
        </div>
        <button ref="closeButton" class="intro-close" type="button" aria-label="Close" autofocus @click="dismiss">
          <XMarkIcon aria-hidden="true" />
        </button>
      </header>

      <div class="intro-example">
        <section class="example-source" aria-label="Example Mermaid source">
          <h3>Example Mermaid source</h3>
          <ol>
            <li
              v-for="(line, index) in source"
              :key="index"
              :class="{ 'updated-line': phase === 'complete' && index === example.editLine }"
            ><span aria-hidden="true">{{ index + 1 }}</span><code>{{ line }}</code></li>
          </ol>
        </section>
        <section class="example-diagram" :aria-label="example.diagramHeading">
          <h3>{{ example.diagramHeading }}</h3>
          <div v-if="isSequence" class="sequence-example">
            <div class="participant">Customer</div>
            <div class="participant">Shop</div>
            <div class="sequence-message">
              <span class="example-label" :class="{ 'label-editing': editing }">
                <span :class="{ 'label-selected': phase === 'selected' }">{{ displayedLabel }}</span>
                <span v-if="phase === 'clicking'" class="click-cue" aria-hidden="true"><CursorArrowRaysIcon /></span>
              </span>
              <div class="example-arrow" aria-hidden="true"></div>
            </div>
          </div>
          <div v-else class="flowchart-example">
            <div class="flowchart-node">Start</div>
            <div class="example-arrow" aria-hidden="true"></div>
            <div class="flowchart-node">
              <span class="example-label" :class="{ 'label-editing': editing }">
                <span :class="{ 'label-selected': phase === 'selected' }">{{ displayedLabel }}</span>
                <span v-if="phase === 'clicking'" class="click-cue" aria-hidden="true"><CursorArrowRaysIcon /></span>
              </span>
            </div>
            <div class="example-arrow" aria-hidden="true"></div>
            <div class="flowchart-node">Send</div>
          </div>
        </section>
      </div>
      <p class="example-note">Example only. Your diagram stays unchanged.</p>
    </div>
    <footer class="intro-footer">
      <button ref="gotItButton" type="button" class="intro-confirm" @click="dismiss">Got it</button>
    </footer>
  </dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CursorArrowRaysIcon from '@heroicons/vue/24/outline/CursorArrowRaysIcon'
import PencilIcon from '@heroicons/vue/24/outline/PencilIcon'
import XMarkIcon from '@heroicons/vue/24/outline/XMarkIcon'
import type { InlineEditDiagram } from '@/utils/analytics/catalog'

const props = defineProps<{
  type: InlineEditDiagram
  workspace: HTMLElement | null
  canOpen: () => boolean
}>()
const emit = defineEmits<{ shown: [reducedMotion: boolean]; dismiss: [] }>()

const examples = {
  sequence: {
    title: 'Rename a sequence message',
    description: 'Double-click an editable label to rename it. Mermaid source updates automatically.',
    diagramHeading: 'Example diagram',
    before: 'Check order',
    after: 'Confirm order',
    editLine: 3,
    source: (label: string) => ['sequenceDiagram', 'participant C as Customer', 'participant S as Shop', `C->>S: ${label}`],
  },
  flowchart: {
    title: 'Edit text on a flowchart',
    description: 'Double-click a node’s text or a label on a connecting arrow to edit it.',
    diagramHeading: 'Example flowchart',
    before: 'Review',
    after: 'Approve',
    editLine: 1,
    source: (label: string) => ['flowchart LR', `A[Start] --> B[${label}]`, 'B --> C[Send]'],
  },
}

const dialog = ref<HTMLDialogElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const gotItButton = ref<HTMLButtonElement | null>(null)
const phase = ref<'initial' | 'clicking' | 'selected' | 'typing' | 'complete'>('initial')
const typedCharacters = ref(0)
const example = computed(() => examples[props.type])
const isSequence = computed(() => props.type === 'sequence')
const editing = computed(() => phase.value === 'selected' || phase.value === 'typing')
const source = computed(() => example.value.source(phase.value === 'complete' ? example.value.after : example.value.before))
const displayedLabel = computed(() => {
  if (phase.value === 'complete') return example.value.after
  if (phase.value === 'typing') return example.value.after.slice(0, typedCharacters.value)
  return example.value.before
})

let previousFocus: HTMLElement | null = null
let motionPreference: MediaQueryList | undefined
const timers: number[] = []

function later(delay: number, action: () => void) {
  timers.push(window.setTimeout(action, delay))
}

function finishExample() {
  timers.splice(0).forEach((timer) => window.clearTimeout(timer))
  phase.value = 'complete'
}

function onMotionChange(event: MediaQueryListEvent) {
  if (event.matches) finishExample()
}

function dismiss() {
  dialog.value?.close()
  previousFocus?.focus({ preventScroll: true })
  if (document.activeElement !== previousFocus || previousFocus === null) {
    const source = props.workspace?.querySelector<HTMLElement>('#workspace-left .cm-content')
    source?.focus({ preventScroll: true })
    if (document.activeElement !== source) {
      props.workspace?.querySelector<HTMLElement>('[data-testid="code-panel-toggle"]')?.focus({ preventScroll: true })
    }
  }
  emit('dismiss')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    dismiss()
  } else if (event.key === 'Tab') {
    event.preventDefault()
    const target = document.activeElement === closeButton.value ? gotItButton.value : closeButton.value
    target?.focus()
  }
}

onMounted(() => {
  if (!props.canOpen() || !dialog.value) {
    emit('dismiss')
    return
  }
  const focused = document.activeElement
  if (focused instanceof HTMLElement && props.workspace?.contains(focused)) previousFocus = focused
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (motionPreference.matches) finishExample()
  dialog.value.showModal()
  closeButton.value?.focus({ preventScroll: true })
  emit('shown', motionPreference.matches)

  if (motionPreference.matches) return
  motionPreference.addEventListener('change', onMotionChange)
  later(500, () => { phase.value = 'clicking' })
  later(900, () => { phase.value = 'selected' })
  later(1400, () => { phase.value = 'typing' })
  for (let count = 1; count <= example.value.after.length; count++) {
    later(1400 + count * 67, () => { typedCharacters.value = count })
  }
  later(2500, finishExample)
})

onBeforeUnmount(() => {
  timers.forEach((timer) => window.clearTimeout(timer))
  motionPreference?.removeEventListener('change', onMotionChange)
})
</script>

<style scoped>
.inline-intro {
  position: fixed;
  inset: 0;
  width: min(722px, calc(100% - 32px));
  max-width: none;
  max-height: calc(100% - 32px);
  margin: auto;
  padding: 0;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid #d3c4f5;
  border-radius: 10px;
  background: #fff;
  color: #172b4d;
  box-shadow: 0 12px 36px #10182840;
}
.inline-intro::backdrop {
  background: rgb(16 24 40 / 55%);
}
.intro-content {
  padding: 15px 15px 5px;
}
.intro-header {
  display: flex;
  gap: 12px;
  min-height: 43px;
  padding-right: 36px;
}
.intro-header h2 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 700;
  line-height: 22px;
}
.intro-header p {
  margin: 0;
  color: #44546f;
  font-size: 13px;
  line-height: 18px;
}
.intro-icon {
  flex: 0 0 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: #eee9fc;
  color: #593bab;
}
.intro-icon svg, .intro-close svg, .click-cue svg {
  width: 17px;
  height: 17px;
}
.intro-close {
  position: absolute;
  top: 10px;
  right: 12px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 5px;
  color: #44546f;
}
.intro-close:hover {
  background: #f0f1f4;
}
.intro-close:focus-visible, .intro-confirm:focus-visible {
  outline: 2px solid #0c66e4;
  outline-offset: 2px;
}
.intro-example {
  display: grid;
  grid-template-columns: 1.06fr 1fr;
  gap: 7px;
  margin-top: 15px;
}
.intro-example section {
  min-width: 0;
  min-height: 110px;
  padding: 9px 11px;
  border: 1px solid #dfe1e8;
  border-radius: 7px;
}
.intro-example h3 {
  margin: 0 0 8px;
  color: #44546f;
  font-size: 10px;
  font-weight: 700;
  line-height: 13px;
  text-transform: uppercase;
}
.example-source {
  background: #f3f4f8;
}
.example-source ol {
  margin: 0;
  padding: 0;
  list-style: none;
  font: 12px/16px ui-monospace, SFMono-Regular, Menlo, monospace;
}
.example-source li {
  display: grid;
  grid-template-columns: 20px 1fr;
  padding-right: 2px;
}
.example-source li span {
  color: #626f86;
}
.example-source li code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
.example-source .updated-line {
  border-radius: 3px;
  background: #dcf3e7;
  color: #164b35;
  box-shadow: -3px 0 #32855a;
}
.intro-example .example-diagram {
  background: #f5f1fc;
  border-color: #e5dcf6;
  color: #2d2348;
}
.example-diagram h3 {
  color: #4e3397;
}
.sequence-example {
  position: relative;
  display: flex;
  justify-content: space-between;
  padding: 0 4px;
  height: 68px;
}
.participant {
  position: relative;
  align-self: start;
  min-width: 70px;
  padding: 2px 6px;
  text-align: center;
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
}
.participant, .flowchart-node {
  background: #ede5fa;
  border: 1px solid #d1c3eb;
  border-radius: 5px;
}
.participant::after {
  position: absolute;
  top: 100%;
  left: 50%;
  height: 45px;
  content: '';
  border-left: 1px dashed #afa4c9;
}
.sequence-message {
  position: absolute;
  top: 23px;
  left: 39px;
  right: 39px;
  display: grid;
  justify-items: center;
}
.example-label {
  position: relative;
  display: inline-grid;
  min-width: 0;
  min-height: 22px;
  align-items: center;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: 3px;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}
.label-editing {
  min-width: 66px;
  border-color: #0c66e4;
  background: white;
  box-shadow: 0 0 0 1px #0c66e433;
}
.label-selected {
  background: #cce0ff;
}
.example-arrow {
  position: relative;
  width: 100%;
  height: 1px;
  background: #8877a8;
}
.example-arrow::after {
  position: absolute;
  top: -2px;
  right: 0;
  width: 5px;
  height: 5px;
  content: '';
  border-right: 1px solid #8877a8;
  border-top: 1px solid #8877a8;
  transform: rotate(45deg);
}
.sequence-message .example-arrow {
  margin-top: 6px;
}
.flowchart-example {
  display: grid;
  grid-template-columns: minmax(0, 1fr) min(26px, 6%) minmax(0, 1fr) min(26px, 6%) minmax(0, 1fr);
  align-items: center;
  padding-top: 8px;
}
.flowchart-node {
  display: grid;
  place-items: center;
  min-height: 38px;
  font-size: 13px;
  font-weight: 600;
}
.click-cue {
  position: absolute;
  top: 55%;
  left: 62%;
  z-index: 1;
  display: grid;
  color: #0c66e4;
  filter: drop-shadow(0 1px 1px #fff);
}
.click-cue::before {
  position: absolute;
  inset: -6px;
  border: 2px solid currentColor;
  border-radius: 50%;
  content: '';
  animation: click-pulse 180ms ease-out 2;
}
@keyframes click-pulse {
  from { transform: scale(.35); opacity: 1; }
  to { transform: scale(1); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .click-cue { display: none; }
}
.example-note {
  margin: 5px 0 0;
  color: #626f86;
  font-size: 11px;
  line-height: 15px;
}
.intro-footer {
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px;
  border-top: 1px solid #dfe1e8;
  background: #fdfdfd;
}
.intro-confirm {
  min-width: 84px;
  min-height: 34px;
  padding: 5px 12px;
  border-radius: 5px;
  background: #0c66e4;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}
.intro-confirm:hover {
  background: #0055cc;
}
</style>
