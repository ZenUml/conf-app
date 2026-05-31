import { ref } from 'vue'
import store from '@/model/store2'
import aiGenerateTitle from '@/apis/aiGenerateTitle'
import getFeatureFlags from '@/apis/featureFlags'
import { DiagramType } from '@/model/Diagram/Diagram'
import { hashString } from '@/utils/hashString'
import { toast } from '@/utils/toast'

export const TYPEWRITER_MS_PER_CHAR = 40
export const SPARK_FADEOUT_MS = 400

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
  if (diagramType === DiagramType.PlantUml) return DiagramType.PlantUml
  return DiagramType.Sequence
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
    hasManuallyEditedTitle.value = true
    genToken += 1
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
