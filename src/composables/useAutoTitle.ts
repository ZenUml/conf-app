import { ref } from 'vue'
import store from '@/model/store2'
import aiGenerateTitle from '@/apis/aiGenerateTitle'
import { resetFeatureFlagsForTests } from '@/apis/aiTitleFeatureFlag'
import { DiagramType } from '@/model/Diagram/Diagram'
import { hashString } from '@/utils/hashString'
import { toast } from '@/utils/toast'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

export const TYPEWRITER_MS_PER_CHAR = 40
export const SPARK_FADEOUT_MS = 400

// AI title generation is available in every product. Keep this state for the
// UI's loading and animation flow, but do not make a runtime feature-flag
// request before exposing the control.
const aiTitleEnabled = ref(true)
const isGeneratingTitle = ref(false)
const isAnimating = ref(false)
const displayedTitle = ref('')
const showSpark = ref(false)
const sparkFadingOut = ref(false)
const showDismiss = ref(false)
const autoNameAnimationDone = ref(false)
const hasManuallyEditedTitle = ref(false)
// True once we've recorded `ai_title_modified` for the CURRENT generated title.
// onInput fires on every keystroke (DiagramTitleInput.vue), so without this latch
// a single edit emitted one event per character. Reset whenever a fresh title is
// generated, so each generated-then-edited title records exactly one modify.
const aiTitleModifyTracked = ref(false)
const lastGeneratedContentHash = ref<string | null>(null)

let genToken = 0

const MERMAID_TYPE_MAP: Record<string, string> = {
  graph: 'flow chart',
  flowchart: 'flow chart',
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
  if (diagramType === DiagramType.PlantUml) return DiagramType.PlantUml
  // Graph (DrawIO) has no text DSL — DrawIoExtension feeds the extracted shape
  // labels as `code`. 'flowchart' nudges the model to summarise the labelled
  // nodes as a process/structure rather than a sequence of messages.
  if (diagramType === DiagramType.Graph) return 'flowchart'
  if (diagramType === DiagramType.OpenApi) return 'OpenAPI specification'
  return DiagramType.Sequence
}

// The AI-title endpoint is expected to return a short title, not a chat
// reply. Occasionally (e.g. when the extracted diagram signal is thin or
// ambiguous) the model answers with a clarifying question instead of a
// title — reject anything that isn't title-shaped rather than trust any
// non-empty response. Conservative on purpose: legitimate short titles must
// never trip these checks.
function looksLikeTitle(s: string): boolean {
  if (s.length > 100) return false
  if (s.includes('\n')) return false
  if (s.trimEnd().endsWith('?')) return false
  return true
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
  displayedTitle.value = ''
  showSpark.value = false
  sparkFadingOut.value = false
  showDismiss.value = false
}

export function useAutoTitle() {
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
    const contentHash = hashString(code)
    if (trigger === 'init') {
      if (hasManuallyEditedTitle.value) return
      if ((currentTitle || '').trim()) return
      if (contentHash === lastGeneratedContentHash.value) return
    }

    const isRegenerate = trigger === 'user' && autoNameAnimationDone.value

    const token = ++genToken
    isGeneratingTitle.value = true
    autoNameAnimationDone.value = false
    showSpark.value = true
    sparkFadingOut.value = false
    const trackProps = {
      feature_area: 'ai' as const,
      surface: 'editor' as const,
      macro_type: diagramType.toLowerCase() as any,
      generation_source: isRegenerate ? 'regenerate' : trigger,
      prompt_length: code.length,
    }
    trackAnalyticsEvent('ai_generation_requested', trackProps)

    try {
      const res: any = await aiGenerateTitle({ dsl: code, type: titleTypeParam(diagramType, code) })
      if (token !== genToken) return
      if (!res.ok) {
        const errText = await res.text()
        if (token !== genToken) return
        trackAnalyticsEvent('ai_generation_failed', { ...trackProps, failure_reason: errText })
        if (trigger === 'user') toast({ message: "Couldn't generate a title — please try again later.", duration: 3000 })
        resetGenerating()
        return
      }
      const title = (await res.text()).trim()
      if (token !== genToken) return
      if (!title) {
        resetGenerating()
        return
      }
      if (!looksLikeTitle(title)) {
        trackAnalyticsEvent('ai_generation_failed', { ...trackProps, failure_reason: 'not_title_like' })
        if (trigger === 'user') toast({ message: "Couldn't generate a title — please try again later.", duration: 3000 })
        resetGenerating()
        return
      }

      trackAnalyticsEvent('ai_generation_succeeded', trackProps)
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
      aiTitleModifyTracked.value = false // fresh title → next manual edit is recordable

      sparkFadingOut.value = true
      await delay(SPARK_FADEOUT_MS)
      if (token !== genToken) return
      showSpark.value = false
      sparkFadingOut.value = false
    } catch (e) {
      if (token !== genToken) return
      trackAnalyticsEvent('ai_generation_failed', { ...trackProps, failure_reason: String(e) })
      if (trigger === 'user') toast({ message: "Couldn't generate a title — please try again later.", duration: 3000 })
      resetGenerating()
    }
  }

  function dismiss(): void {
    trackAnalyticsEvent('ai_title_dismissed', { feature_area: 'ai', surface: 'editor' })
    genToken += 1
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
  }

  function markManualEdit(): void {
    if (autoNameAnimationDone.value && !aiTitleModifyTracked.value) {
      trackAnalyticsEvent('ai_title_modified', { feature_area: 'ai', surface: 'editor' })
      aiTitleModifyTracked.value = true // latch: ignore the rest of this edit's keystrokes
    }
    hasManuallyEditedTitle.value = true
    genToken += 1
    resetGenerating()
  }

  function onTitleCleared(): void {
    hasManuallyEditedTitle.value = false
    lastGeneratedContentHash.value = null
  }

  function reset(): void {
    genToken += 1
    isGeneratingTitle.value = false
    isAnimating.value = false
    displayedTitle.value = ''
    showSpark.value = false
    sparkFadingOut.value = false
    showDismiss.value = false
    autoNameAnimationDone.value = false
    hasManuallyEditedTitle.value = false
    lastGeneratedContentHash.value = null
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
    generate,
    dismiss,
    markManualEdit,
    onTitleCleared,
    reset,
  }
}

export function notifyAiTitleSaved(opts?: { title?: string; contentId?: string }): void {
  if (autoNameAnimationDone.value) {
    trackAnalyticsEvent('ai_title_accepted', {
      feature_area: 'ai',
      surface: 'editor',
      ...(opts?.title && { accepted_title: opts.title }),
      ...(opts?.contentId && { content_id: opts.contentId }),
    })
    autoNameAnimationDone.value = false
  }
}

;(useAutoTitle as any).__resetForTests = () => {
  aiTitleEnabled.value = true
  isGeneratingTitle.value = false
  isAnimating.value = false
  displayedTitle.value = ''
  showSpark.value = false
  sparkFadingOut.value = false
  showDismiss.value = false
  autoNameAnimationDone.value = false
  hasManuallyEditedTitle.value = false
  aiTitleModifyTracked.value = false
  lastGeneratedContentHash.value = null
  genToken = 0
  resetFeatureFlagsForTests()
}
