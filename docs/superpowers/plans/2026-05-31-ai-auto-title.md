# AI Auto-Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Sequence/Mermaid/PlantUML diagram has content but an empty title, auto-generate an AI title (debounced) with a spark → typewriter → dismiss animation, reusing the existing Cloudflare `ai-generate-title` endpoint and `AI_TITLE` flag.

**Architecture:** Extract the title bar out of `Header.vue` into a focused `DiagramTitleInput.vue` that consumes a new `useAutoTitle` composable holding the state machine (guards, dedup hash, API call, typewriter, dismiss). Backend is reused unchanged. The composable writes the final title to the Vuex store via `updateTitle`; during the typewriter animation the input is driven by a local `displayedTitle` so progressive UI updates don't re-fire the trigger.

**Tech Stack:** Vue 3 (`<script setup>`), Vuex (`@/model/store2` singleton), Vitest + `@vue/test-utils`, Tailwind, Cloudflare Pages Functions, `tiny-emitter` EventBus.

**Reference spec:** `docs/superpowers/specs/2026-05-31-ai-auto-title-design.md`

---

## File Structure

**Create:**
- `src/utils/hashString.ts` — dependency-free FNV-1a string hash (dedup key)
- `tests/unit/hashString.spec.ts`
- `src/composables/useAutoTitle.ts` — the state machine + orchestration
- `src/composables/useAutoTitle.spec.ts` — primary unit tests (all guards + flow)
- `src/components/icons/IconSpark.vue` — gradient spark SVG (from issue)
- `src/components/icons/IconDismiss.vue` — × SVG (from issue)
- `src/components/Header/DiagramTitleInput.vue` — extracted title bar + animation UI
- `tests/unit/DiagramTitleInput.spec.ts` — component mount test

**Modify:**
- `src/components/Header/Header.vue` — remove inline title block + consent Modal + AI logic; embed `<DiagramTitleInput />`; rewire `saveAndExit`/`isPublishDisabled` via EventBus
- `functions/ai-generate-title.ts` — one-line prompt nudge toward ≤60 chars

---

## Task 1: Content hash utility

**Files:**
- Create: `src/utils/hashString.ts`
- Test: `tests/unit/hashString.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/hashString.spec.ts
import { describe, it, expect } from 'vitest'
import { hashString } from '@/utils/hashString'

describe('hashString', () => {
  it('is deterministic for the same input', () => {
    expect(hashString('A->B: hi')).toBe(hashString('A->B: hi'))
  })

  it('differs for different input', () => {
    expect(hashString('A->B: hi')).not.toBe(hashString('A->B: bye'))
  })

  it('returns a non-empty hex string for empty input', () => {
    expect(hashString('')).toMatch(/^[0-9a-f]+$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ../conf-app-ai-auto-title && npx vitest --run tests/unit/hashString.spec.ts`
Expected: FAIL — cannot resolve `@/utils/hashString`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/hashString.ts
// FNV-1a 32-bit hash, returned as hex. Deterministic and dependency-free —
// used as the dedup key for AI auto-title generation.
export function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run tests/unit/hashString.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/hashString.ts tests/unit/hashString.spec.ts
git commit -m "feat(ai-title): add FNV-1a hashString util for dedup"
```

---

## Task 2: `useAutoTitle` composable

**Files:**
- Create: `src/composables/useAutoTitle.ts`
- Test: `src/composables/useAutoTitle.spec.ts`

This is the core. The composable holds module-level singleton reactive state (matching `useCustomerSuccessService` style) and exposes `initFlag`, `generate`, `dismiss`, `markManualEdit`.

- [ ] **Step 1: Write the failing test**

```ts
// src/composables/useAutoTitle.spec.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DiagramType } from '@/model/Diagram/Diagram'

// Fake Vuex store: only updateTitle is exercised by the composable.
const fakeStore = vi.hoisted(() => {
  const state = { diagram: { title: '' } as { title: string } }
  return {
    state,
    dispatch: vi.fn((action: string, payload: any) => {
      if (action === 'updateTitle') state.diagram.title = (payload || '').trim()
    }),
  }
})
vi.mock('@/model/store2', () => ({ default: fakeStore }))
vi.mock('@/apis/aiGenerateTitle', () => ({ default: vi.fn() }))
vi.mock('@/apis/featureFlags', () => ({
  default: vi.fn().mockResolvedValue({ AI_TITLE: { enabled: true } }),
}))
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }))

import { useAutoTitle, TYPEWRITER_MS_PER_CHAR, SPARK_FADEOUT_MS } from './useAutoTitle'
import aiGenerateTitle from '@/apis/aiGenerateTitle'
import getFeatureFlags from '@/apis/featureFlags'
import { toast } from '@/utils/toast'

const okRes = (text: string) => ({ ok: true, text: async () => text }) as any
const errRes = (text: string) => ({ ok: false, text: async () => text }) as any
const SEQ = { code: 'A->B: hi', diagramType: DiagramType.Sequence, currentTitle: '' }

// Advance through the full success animation: fetch microtask + typewriter + spark fade.
async function runAnimation(title: string) {
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(title.length * TYPEWRITER_MS_PER_CHAR + SPARK_FADEOUT_MS + 20)
}

describe('useAutoTitle', () => {
  beforeEach(() => {
    ;(useAutoTitle as any).__resetForTests()
    fakeStore.dispatch.mockClear()
    fakeStore.state.diagram.title = ''
    vi.mocked(aiGenerateTitle).mockReset()
    vi.mocked(getFeatureFlags).mockResolvedValue({ AI_TITLE: { enabled: true } } as any)
    vi.mocked(toast).mockClear()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('initFlag enables when AI_TITLE flag is on', async () => {
    const { initFlag, aiTitleEnabled } = useAutoTitle()
    await initFlag()
    expect(aiTitleEnabled.value).toBe(true)
  })

  it('does not call the API when the flag is off', async () => {
    vi.mocked(getFeatureFlags).mockResolvedValue({ AI_TITLE: { enabled: false } } as any)
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    await generate('init', SEQ)
    expect(aiGenerateTitle).not.toHaveBeenCalled()
  })

  it('skips auto when a title already exists', async () => {
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    await generate('init', { ...SEQ, currentTitle: 'Already named' })
    expect(aiGenerateTitle).not.toHaveBeenCalled()
  })

  it('skips auto after a manual edit', async () => {
    const { initFlag, generate, markManualEdit } = useAutoTitle()
    await initFlag()
    markManualEdit()
    await generate('init', SEQ)
    expect(aiGenerateTitle).not.toHaveBeenCalled()
  })

  it('skips when there is no diagram content', async () => {
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    await generate('init', { ...SEQ, code: '   ' })
    expect(aiGenerateTitle).not.toHaveBeenCalled()
  })

  it('commits the typed-out title to the store on success', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { initFlag, generate, showSpark } = useAutoTitle()
    await initFlag()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    expect(aiGenerateTitle).toHaveBeenCalledWith({ dsl: 'A->B: hi', type: 'sequence' })
    expect(fakeStore.dispatch).toHaveBeenCalledWith('updateTitle', 'Order Checkout')
    expect(showSpark.value).toBe(false) // faded out in Phase 3
  })

  it('does not re-trigger for unchanged content (dedup hash)', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    fakeStore.state.diagram.title = '' // pretend title got cleared again
    await generate('init', SEQ) // same code → deduped
    expect(aiGenerateTitle).toHaveBeenCalledTimes(1)
  })

  it('ignores a concurrent generate while one is in flight', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    const p1 = generate('init', SEQ)
    await generate('init', SEQ) // blocked by isGeneratingTitle
    await runAnimation('Order Checkout')
    await p1
    expect(aiGenerateTitle).toHaveBeenCalledTimes(1)
  })

  it('reverts the title to empty on dismiss and stays deduped', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { initFlag, generate, dismiss } = useAutoTitle()
    await initFlag()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    fakeStore.dispatch.mockClear()
    dismiss()
    expect(fakeStore.dispatch).toHaveBeenCalledWith('updateTitle', '')
    await generate('init', SEQ) // dedup still holds after dismiss
    expect(aiGenerateTitle).toHaveBeenCalledTimes(1)
  })

  it('is silent on auto-trigger errors but toasts on manual errors', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(errRes('boom'))
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    await generate('init', SEQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(toast).not.toHaveBeenCalled()
    await generate('user', SEQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(toast).toHaveBeenCalled()
  })

  it('maps Mermaid + PlantUML to the right type param', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('T'))
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    const p1 = generate('user', { code: 'sequenceDiagram\n A->>B: hi', diagramType: DiagramType.Mermaid, currentTitle: '' })
    await runAnimation('T'); await p1
    const p2 = generate('user', { code: '@startuml\nA->B\n@enduml', diagramType: DiagramType.PlantUml, currentTitle: '' })
    await runAnimation('T'); await p2
    expect(aiGenerateTitle).toHaveBeenNthCalledWith(1, { dsl: 'sequenceDiagram\n A->>B: hi', type: 'sequence' })
    expect(aiGenerateTitle).toHaveBeenNthCalledWith(2, { dsl: '@startuml\nA->B\n@enduml', type: 'plantuml' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/composables/useAutoTitle.spec.ts`
Expected: FAIL — cannot resolve `./useAutoTitle`.

- [ ] **Step 3: Write the implementation**

```ts
// src/composables/useAutoTitle.ts
import { ref } from 'vue'
import store from '@/model/store2'
import aiGenerateTitle from '@/apis/aiGenerateTitle'
import getFeatureFlags from '@/apis/featureFlags'
import { DiagramType } from '@/model/Diagram/Diagram'
import { hashString } from '@/utils/hashString'
import { toast } from '@/utils/toast'

export const TYPEWRITER_MS_PER_CHAR = 40
export const SPARK_FADEOUT_MS = 400

// Module-level singleton state (one editor at a time).
const aiTitleEnabled = ref(false)
const isGeneratingTitle = ref(false)
const isAnimating = ref(false)
const displayedTitle = ref('')
const showSpark = ref(false)
const sparkFadingOut = ref(false)
const showDismiss = ref(false)
const autoNameAnimationDone = ref(false)
const hasManuallyEditedTitle = ref(false)
const lastGeneratedContentHash = ref<string | null>(null)

let genToken = 0
let flagLoaded = false

const MERMAID_TYPE_MAP: Record<string, string> = {
  graph: 'flow chart',
  sequenceDiagram: 'sequence',
  gantt: 'gantt chart',
  classDiagram: 'class',
  gitGraph: 'git',
  erDiagram: 'entity relationship',
  journey: 'journey',
  quadrantChart: 'quadrant chart',
  'xychart-beta': 'xy chart',
}

function getMermaidType(dsl: string): string {
  const first = dsl.trim().split('\n')[0].split(' ')[0]
  return MERMAID_TYPE_MAP[first] || first
}

function titleTypeParam(diagramType: DiagramType, code: string): string {
  if (diagramType === DiagramType.Mermaid) return getMermaidType(code)
  if (diagramType === DiagramType.PlantUml) return DiagramType.PlantUml // 'plantuml'
  return DiagramType.Sequence // 'sequence'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function typeOut(title: string, token: number): Promise<void> {
  return new Promise((resolve) => {
    let i = 0
    const id = setInterval(() => {
      if (token !== genToken) {
        clearInterval(id)
        resolve()
        return
      }
      i += 1
      displayedTitle.value = title.slice(0, i)
      if (i >= title.length) {
        clearInterval(id)
        resolve()
      }
    }, TYPEWRITER_MS_PER_CHAR)
  })
}

function resetGenerating(): void {
  isGeneratingTitle.value = false
  isAnimating.value = false
  showSpark.value = false
  sparkFadingOut.value = false
  showDismiss.value = false
}

export function useAutoTitle() {
  async function initFlag(): Promise<void> {
    if (flagLoaded) return
    try {
      const flags: any = await getFeatureFlags(['AI_TITLE'])
      aiTitleEnabled.value = !!flags?.AI_TITLE?.enabled
    } catch (e) {
      console.error('Failed to load AI_TITLE flag', e)
      aiTitleEnabled.value = false
    } finally {
      flagLoaded = true
    }
  }

  async function generate(
    trigger: 'init' | 'user',
    opts: { code: string; diagramType: DiagramType; currentTitle: string },
  ): Promise<void> {
    const { code, diagramType, currentTitle } = opts

    if (!aiTitleEnabled.value) return
    if (isGeneratingTitle.value) return
    if (!(code || '').trim()) {
      if (trigger === 'user') toast({ message: 'Add some diagram code first', duration: 3000 })
      return
    }
    if (trigger === 'init') {
      if (hasManuallyEditedTitle.value) return
      if ((currentTitle || '').trim()) return
      if (hashString(code) === lastGeneratedContentHash.value) return
    }

    const token = ++genToken
    const contentHash = hashString(code)
    isGeneratingTitle.value = true
    autoNameAnimationDone.value = false
    showSpark.value = true
    sparkFadingOut.value = false

    try {
      const res: any = await aiGenerateTitle({ dsl: code, type: titleTypeParam(diagramType, code) })
      if (token !== genToken) return
      if (!res.ok) {
        if (trigger === 'user') toast({ message: await res.text(), duration: 3000 })
        resetGenerating()
        return
      }
      const title = (await res.text()).trim()
      if (token !== genToken) return
      if (!title) {
        resetGenerating()
        return
      }

      lastGeneratedContentHash.value = contentHash
      isAnimating.value = true
      showDismiss.value = true
      displayedTitle.value = ''
      await typeOut(title, token)
      if (token !== genToken) return

      store.dispatch('updateTitle', title)
      isAnimating.value = false
      isGeneratingTitle.value = false
      autoNameAnimationDone.value = true

      sparkFadingOut.value = true
      await delay(SPARK_FADEOUT_MS)
      if (token !== genToken) return
      showSpark.value = false
      sparkFadingOut.value = false
    } catch (e) {
      if (token !== genToken) return
      if (trigger === 'user') toast({ message: String(e), duration: 3000 })
      resetGenerating()
    }
  }

  function dismiss(): void {
    genToken += 1 // invalidate any in-flight generation
    store.dispatch('updateTitle', '')
    isAnimating.value = false
    displayedTitle.value = ''
    showDismiss.value = false
    autoNameAnimationDone.value = false
    isGeneratingTitle.value = false
    sparkFadingOut.value = true
    const token = genToken
    setTimeout(() => {
      if (token !== genToken) return
      showSpark.value = false
      sparkFadingOut.value = false
    }, SPARK_FADEOUT_MS)
    // lastGeneratedContentHash is intentionally retained → no re-trigger until content changes.
  }

  function markManualEdit(): void {
    hasManuallyEditedTitle.value = true
    genToken += 1 // abort any in-flight generation
    resetGenerating()
  }

  return {
    aiTitleEnabled,
    isGeneratingTitle,
    isAnimating,
    displayedTitle,
    showSpark,
    sparkFadingOut,
    showDismiss,
    autoNameAnimationDone,
    hasManuallyEditedTitle,
    initFlag,
    generate,
    dismiss,
    markManualEdit,
  }
}

;(useAutoTitle as any).__resetForTests = () => {
  aiTitleEnabled.value = false
  isGeneratingTitle.value = false
  isAnimating.value = false
  displayedTitle.value = ''
  showSpark.value = false
  sparkFadingOut.value = false
  showDismiss.value = false
  autoNameAnimationDone.value = false
  hasManuallyEditedTitle.value = false
  lastGeneratedContentHash.value = null
  genToken = 0
  flagLoaded = false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/composables/useAutoTitle.spec.ts`
Expected: PASS (all `it` blocks).

- [ ] **Step 5: Commit**

```bash
git add src/composables/useAutoTitle.ts src/composables/useAutoTitle.spec.ts
git commit -m "feat(ai-title): add useAutoTitle state machine composable"
```

---

## Task 3: Spark and dismiss icon components

**Files:**
- Create: `src/components/icons/IconSpark.vue`
- Create: `src/components/icons/IconDismiss.vue`

No dedicated test (static SVG; exercised by the component test in Task 4). SVGs are copied verbatim from issue #171.

- [ ] **Step 1: Create `IconSpark.vue`**

```vue
<!-- src/components/icons/IconSpark.vue -->
<template>
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <defs>
      <linearGradient :id="gradId" x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#7C3AED" />
        <stop offset="100%" stop-color="#EC4899" />
      </linearGradient>
    </defs>
    <path d="M8 1.5L9.2 5.5L13 6.5L9.2 7.5L8 11.5L6.8 7.5L3 6.5L6.8 5.5L8 1.5Z" :fill="`url(#${gradId})`" />
    <path d="M12.5 0L13.2 2L15.5 2.5L13.2 3L12.5 5L11.8 3L9.5 2.5L11.8 2L12.5 0Z" :fill="`url(#${gradId})`" opacity="0.7" />
    <path d="M3 10L3.5 11.5L5 12L3.5 12.5L3 14L2.5 12.5L1 12L2.5 11.5L3 10Z" :fill="`url(#${gradId})`" opacity="0.5" />
  </svg>
</template>

<script setup lang="ts">
// Unique gradient id per instance so multiple sparks on a page don't collide.
const gradId = `spark-grad-${Math.random().toString(36).slice(2, 9)}`
</script>
```

- [ ] **Step 2: Create `IconDismiss.vue`**

```vue
<!-- src/components/icons/IconDismiss.vue -->
<template>
  <svg viewBox="0 0 22 22" width="14" height="14" aria-hidden="true">
    <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
      d="M6.76 15.24l8.48-8.48m0 8.48L6.76 6.76" />
  </svg>
</template>

<script setup lang="ts"></script>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/icons/IconSpark.vue src/components/icons/IconDismiss.vue
git commit -m "feat(ai-title): add spark and dismiss icon components"
```

---

## Task 4: `DiagramTitleInput.vue` component

**Files:**
- Create: `src/components/Header/DiagramTitleInput.vue`
- Test: `tests/unit/DiagramTitleInput.spec.ts`

The component owns the title bar UI, the debounced auto-trigger, the manual button, and `titleError` (set via EventBus `flash-title-error`, cleared on input / tab change). The state machine lives in the composable; the component test stays light (rendering + input dispatch + dismiss wiring), since the composable spec covers the flow.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/DiagramTitleInput.spec.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { DiagramType } from '@/model/Diagram/Diagram'

const fakeStore = vi.hoisted(() => {
  const state = { diagram: { title: '', diagramType: 'sequence', code: 'A->B: hi' } as any }
  return {
    state,
    dispatch: vi.fn((action: string, payload: any) => {
      if (action === 'updateTitle') state.diagram.title = (payload || '').trim()
    }),
  }
})
vi.mock('@/model/store2', () => ({ default: fakeStore }))
vi.mock('@/apis/aiGenerateTitle', () => ({ default: vi.fn().mockResolvedValue({ ok: true, text: async () => 'T' }) }))
vi.mock('@/apis/featureFlags', () => ({ default: vi.fn().mockResolvedValue({ AI_TITLE: { enabled: true } }) }))
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }))

import DiagramTitleInput from '@/components/Header/DiagramTitleInput.vue'
import { useAutoTitle } from '@/composables/useAutoTitle'
import EventBus from '@/EventBus'

describe('DiagramTitleInput', () => {
  beforeEach(() => {
    ;(useAutoTitle as any).__resetForTests()
    fakeStore.dispatch.mockClear()
    fakeStore.state.diagram.title = ''
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('shows the manual generate button when the flag is enabled', async () => {
    const wrapper = mount(DiagramTitleInput)
    await flushPromises() // initFlag resolves
    expect(wrapper.find('button[title="Generate title with AI"]').exists()).toBe(true)
  })

  it('dispatches updateTitle and locks auto on manual typing', async () => {
    const wrapper = mount(DiagramTitleInput)
    await flushPromises()
    await wrapper.find('input').setValue('My own title')
    expect(fakeStore.dispatch).toHaveBeenCalledWith('updateTitle', 'My own title')
    expect((useAutoTitle() as any).hasManuallyEditedTitle.value).toBe(true)
  })

  it('flashes the error border on the flash-title-error event', async () => {
    const wrapper = mount(DiagramTitleInput)
    await flushPromises()
    EventBus.$emit('flash-title-error')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.border-red-400').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run tests/unit/DiagramTitleInput.spec.ts`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Write the component**

```vue
<!-- src/components/Header/DiagramTitleInput.vue -->
<template>
  <div class="flex items-center flex-1 min-w-64 border-2 rounded-md transition-colors duration-200 h-10"
    :class="titleError ? 'border-red-400 bg-red-50' : 'border-gray-200 hover:border-gray-300 focus-within:border-blue-500'">
    <span class="pl-3 pr-2 text-xs font-semibold tracking-wide text-gray-400 uppercase select-none flex-shrink-0">Title</span>
    <div class="w-px h-4 bg-gray-200 flex-shrink-0"></div>

    <span v-if="showSpark" class="pl-2 flex items-center" :class="sparkFadingOut ? 'autoname-spark-out' : 'autoname-spark-in'">
      <IconSpark />
    </span>

    <input
      type="text"
      placeholder="Name your diagram…"
      :value="inputValue"
      @input="onInput"
      class="flex-1 px-2 py-2 bg-transparent outline-none text-sm min-w-0"
      :class="[titleError ? 'text-red-700 placeholder-red-300' : '', isAnimating ? 'autoname-typing' : '']" />

    <button v-if="showDismiss" type="button" class="autoname-dismiss flex items-center justify-center flex-shrink-0"
      title="Dismiss suggested title" @click="onDismiss">
      <IconDismiss />
    </button>

    <div v-if="aiTitleEnabled" class="pr-1 flex items-center flex-shrink-0">
      <button class="rounded-md p-1 text-gray-600 hover:bg-gray-200 transition-colors duration-200"
        :class="{ 'pointer-events-none opacity-50 cursor-not-allowed': isGeneratingTitle }"
        title="Generate title with AI" :disabled="isGeneratingTitle" @click="onManualGenerate">
        <SparklesIcon v-if="!isGeneratingTitle" class="w-5 h-5" />
        <ArrowPathIcon v-else class="w-5 h-5 animate-spin" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import { getCodeFromDiagram } from '@/model/Diagram/DiagramTypeConfig'
import EventBus from '@/EventBus'
import { useAutoTitle } from '@/composables/useAutoTitle'
import IconSpark from '@/components/icons/IconSpark.vue'
import IconDismiss from '@/components/icons/IconDismiss.vue'
import SparklesIcon from '@heroicons/vue/24/outline/SparklesIcon'
import ArrowPathIcon from '@heroicons/vue/24/outline/ArrowPathIcon'

const AUTO_DEBOUNCE_MS = 1500

const {
  aiTitleEnabled, isGeneratingTitle, isAnimating, displayedTitle,
  showSpark, sparkFadingOut, showDismiss,
  initFlag, generate, dismiss, markManualEdit,
} = useAutoTitle()

const titleError = ref(false)

const currentTitle = computed<string>(() => store.state.diagram.title || '')
const diagramType = computed<DiagramType>(() => store.state.diagram.diagramType)
const currentCode = computed<string>(() => getCodeFromDiagram(store.state.diagram, diagramType.value))
const inputValue = computed<string>(() => (isAnimating.value ? displayedTitle.value : currentTitle.value))

let debounceTimer: ReturnType<typeof setTimeout> | undefined

function scheduleAutoGenerate() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    generate('init', { code: currentCode.value, diagramType: diagramType.value, currentTitle: currentTitle.value })
  }, AUTO_DEBOUNCE_MS)
}

function onInput(e: Event) {
  titleError.value = false
  markManualEdit()
  store.dispatch('updateTitle', (e.target as HTMLInputElement).value)
}

function onManualGenerate() {
  generate('user', { code: currentCode.value, diagramType: diagramType.value, currentTitle: currentTitle.value })
}

function onDismiss() {
  dismiss()
}

function onFlashTitleError() {
  titleError.value = true
}

watch(currentCode, () => scheduleAutoGenerate())
watch(diagramType, () => { titleError.value = false })

onMounted(async () => {
  EventBus.$on('flash-title-error', onFlashTitleError)
  await initFlag()
  if (aiTitleEnabled.value) scheduleAutoGenerate()
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  EventBus.$off('flash-title-error', onFlashTitleError)
})
</script>

<style scoped>
@keyframes autoname-spark-fadein { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
@keyframes autoname-spark-fadeout { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.6); } }
.autoname-spark-in { animation: autoname-spark-fadein 300ms ease-out forwards; }
.autoname-spark-out { animation: autoname-spark-fadeout 400ms ease-in forwards; }

@keyframes autoname-blink { 0%, 100% { border-right-color: #7C3AED; } 50% { border-right-color: transparent; } }
.autoname-typing { border-right: 2px solid #7C3AED; animation: autoname-blink 0.8s step-end infinite; }

.autoname-dismiss { width: 22px; height: 22px; border-radius: 4px; background: transparent; color: #42526E; }
.autoname-dismiss:hover { background: #EBECF0; color: #172B4D; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run tests/unit/DiagramTitleInput.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Header/DiagramTitleInput.vue tests/unit/DiagramTitleInput.spec.ts
git commit -m "feat(ai-title): add DiagramTitleInput component with auto-title UX"
```

---

## Task 5: Wire `DiagramTitleInput` into `Header.vue`

**Files:**
- Modify: `src/components/Header/Header.vue`

Remove the inline title block, the consent `Modal`, and all manual-AI logic; embed `<DiagramTitleInput />`; rewire publish gating via EventBus. There is no existing Header spec, so no test to update — verification is the full suite + lint in Task 7.

- [ ] **Step 1: Replace the title block in the template**

Replace `Header.vue` lines 8–29 (the `<div class="flex items-center flex-1 min-w-64 ...">` title block, including the AI button) with:

```html
      <DiagramTitleInput />
```

- [ ] **Step 2: Remove the consent Modal from the template**

Delete the `<Modal :visible="noticeModalVisible" ...> ... </Modal>` block (lines 55–64).

- [ ] **Step 3: Update imports + components**

Remove these imports: `Modal`, `aiGenerateTitle`, `SparklesIcon`, `ArrowPathIcon`, and `toast` (the manual-AI toast is gone from Header). Add:

```js
import DiagramTitleInput from "@/components/Header/DiagramTitleInput.vue";
```

In `components`, remove `Modal`, `SparklesIcon`, `ArrowPathIcon`; add `DiagramTitleInput`.

- [ ] **Step 4: Remove `getMermaidType` helper**

Delete the module-level `function getMermaidType(dsl) { ... }` (lines 88–102) — it now lives in `useAutoTitle`.

- [ ] **Step 5: Trim `data()`**

Remove `titleError`, `titleLoading`, `noticeModalVisible`, `aiTitleFeatureEnabled`. Keep `helpUrl`, `originalCode`, `diagramOptions`. Result:

```js
  data() {
    return {
      helpUrl: "https://zenuml.com/docs?utm_source=confluence-plugin&utm_medium=help-button&utm_campaign=confluence-plugin",
      originalCode: "",
      diagramOptions: getEditorDiagramOptions()
    };
  },
```

- [ ] **Step 6: Update computed + remove the `watch`**

In `computed`: remove `isAiTitleEnabled`, `currentTitle`, and the `title` entry inside `mapState` (no longer referenced). Rewrite `saveAndExit` and `isPublishDisabled`:

```js
    saveAndExit: function () {
      return () => {
        if (!this.$store.state.diagram.title) {
          EventBus.$emit("flash-title-error");
          return;
        }
        EventBus.$emit("save");
      };
    },
```

```js
    isPublishDisabled: function () {
      return !this.$store.state.diagram.title;
    },
```

Delete the entire `watch: { diagramType: function () { this.titleError = false; } }` block (the child now clears its own error on tab change).

- [ ] **Step 7: Remove manual-AI methods**

Delete `handleTitleChange`, `handleGenerateTitle`, `handleCloseModal`, and `generateTitle` from `methods`. Keep `templateClick`, `helpClick`, `exit`, and the `mapMutations(["updateDiagramType"])` spread.

- [ ] **Step 8: Clean up `mounted()`**

Delete the final two lines:

```js
    // this.aiTitleFeatureEnabled = await getFeatureFlags(['AI_TITLE']).then(res => res.AI_TITLE.enabled);
    this.aiTitleFeatureEnabled = false; // Disable the AI title feature as it is not ready
```

- [ ] **Step 9: Run the full unit suite + type check**

Run: `npx vitest --run`
Expected: PASS (new specs green; nothing else broken).
Run: `npx vue-tsc --noEmit` (if the repo uses it) or `pnpm lint:vue`
Expected: no errors in `Header.vue` / new files.

- [ ] **Step 10: Commit**

```bash
git add src/components/Header/Header.vue
git commit -m "refactor(ai-title): embed DiagramTitleInput, drop consent modal + manual-AI logic from Header"
```

---

## Task 6: Backend prompt nudge toward ≤60 chars

**Files:**
- Modify: `functions/ai-generate-title.ts:15`

Small quality tweak; the endpoint contract is unchanged (still returns a plain title string).

- [ ] **Step 1: Edit strategy #1 system prompt**

Change the `content` on line 15 from:

```
content: `You will help the user to create a title for an ${type || 'UML'} diagram, the user will give a DSL that describing an ${type || 'UML'} diagram, you should just give out one title describing the whole UML and enclose it with triple quotes (like: """example title""").`,
```

to:

```
content: `You will help the user to create a title for an ${type || 'UML'} diagram, the user will give a DSL that describing an ${type || 'UML'} diagram, you should just give out one concise title (ideally under 60 characters) describing the whole UML and enclose it with triple quotes (like: """example title""").`,
```

- [ ] **Step 2: Commit**

```bash
git add functions/ai-generate-title.ts
git commit -m "feat(ai-title): nudge generated titles under 60 chars"
```

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest --run`
Expected: all green, including `hashString`, `useAutoTitle`, `DiagramTitleInput`.

- [ ] **Step 2: Lint**

Run: `pnpm lint:vue`
Expected: no new warnings/errors in the created/modified files.

- [ ] **Step 3: Manual smoke (optional, if a dev server is available)**

Check `http://localhost:3000` is already running (per CLAUDE.md, don't start a second server). With the `AI_TITLE` flag enabled for the test domain, open a new Sequence diagram, paste sample code, leave the title empty, and confirm: spark fades in → title types out → × appears → spark fades, × remains → clicking × reverts to empty and doesn't re-fire until the code changes.

- [ ] **Step 4: Final commit (if any lint fixes were needed)**

```bash
git add -A
git commit -m "chore(ai-title): lint fixes"
```

---

## Notes for the implementer

- **Run all vitest commands from the worktree** `../conf-app-ai-auto-title` (the branch is `feature/ai-auto-title`). The main checkout has unrelated uncommitted work — do not touch it.
- **`aiGenerateTitle` returns a raw `fetch` `Response`** — use `res.ok` and `await res.text()`, never `res.json()`.
- **Store is a direct singleton import** (`import store from '@/model/store2'`), not `this.$store`, so it's mockable in unit tests via `vi.mock('@/model/store2', ...)`.
- **`updateTitle` trims its payload** — dispatching `''` yields `''` (empty = the "Untitled diagram" display fallback in `GenericViewer`).
- **Turning the flag on is out of scope** — it's an ops step (`AI_TITLE_ENABLED_DOMAINS` KV) requiring explicit go-ahead. The code reads the flag; production enablement is separate.
- **Fake timers:** `useAutoTitle` uses `setInterval` (typewriter) + `setTimeout` (spark fade / debounce). Use `vi.advanceTimersByTimeAsync` so awaited microtasks flush between timer ticks.
```
