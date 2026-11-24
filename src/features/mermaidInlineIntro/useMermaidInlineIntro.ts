import { inject, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch, type InjectionKey, type Ref } from 'vue'
import forgeGlobal, { getContext } from '@/model/globals/forgeGlobal'
import type { InlineEditDiagram } from '@/utils/analytics/catalog'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { reportInlineIntroRender } from '@/features/mermaidInlineEdit/ui/surface'
import { isSequenceSvg } from '@/features/mermaidInlineEdit/ui/domMapping'
import { isFlowchartSvg } from '@/features/mermaidInlineEdit/ui/flowchartAdapter'
import { createIntroSeenStore, type IntroAccount, type IntroSeenStore } from './seen'

interface IntroCandidate {
  account: IntroAccount
  type: InlineEditDiagram
}

export const inlineIntroSeenStore: InjectionKey<IntroSeenStore> = Symbol('mermaidInlineIntroSeenStore')

export function useMermaidInlineIntro({
  mermaidCode,
  covered,
  workspace,
}: {
  mermaidCode: Ref<string | null>
  covered: Ref<boolean>
  workspace: Ref<HTMLElement | null>
}) {
  const store = inject(inlineIntroSeenStore, null) ?? createIntroSeenStore()
  const account = shallowRef<IntroAccount | null>(null)
  const rendered = shallowRef<{ code: string; type: InlineEditDiagram | null } | null>(null)
  const intro = shallowRef<IntroCandidate | null>(null)
  const visible = ref(false)
  const checks = new Map<InlineEditDiagram, Promise<boolean | undefined>>()

  function syncVisibility() {
    visible.value = document.visibilityState === 'visible'
  }

  provide(reportInlineIntroRender, (code, svg) => {
    const type = isSequenceSvg(svg) ? 'sequence' : isFlowchartSvg(svg) ? 'flowchart' : null
    rendered.value = { code, type }
  })

  onMounted(async () => {
    if (typeof HTMLDialogElement.prototype.showModal !== 'function') return
    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)
    try {
      const context = await getContext()
      if (!forgeGlobal.isForge || !context?.accountId || !context.cloudId) return
      account.value = { accountId: context.accountId, cloudId: context.cloudId }
    } catch {
      // The editor works without onboarding if Forge context is unavailable.
    }
  })
  onBeforeUnmount(() => document.removeEventListener('visibilitychange', syncVisibility))

  function canShow(type: InlineEditDiagram) {
    return visible.value && !covered.value && rendered.value?.type === type
      && rendered.value.code === mermaidCode.value && !!workspace.value?.getClientRects().length
  }

  watch([account, rendered, mermaidCode, covered, visible, intro], async (_, _previous, onCleanup) => {
    const type = rendered.value?.type
    const currentAccount = account.value
    if (!type || !currentAccount || intro.value || !canShow(type)) return

    let stale = false
    onCleanup(() => { stale = true })
    let check = checks.get(type)
    if (!check) {
      check = store.seen(currentAccount, type)
      checks.set(type, check)
    }
    const seen = await check
    if (stale || seen !== false || store.cached(currentAccount, type) || !canShow(type)) return
    intro.value = { account: currentAccount, type }
  }, { flush: 'post' })

  function canOpen() {
    const candidate = intro.value
    return !!candidate && canShow(candidate.type) && !store.cached(candidate.account, candidate.type)
  }

  function onShown(reducedMotion: boolean) {
    const candidate = intro.value
    if (!candidate) return
    store.record(candidate.account, candidate.type)
    trackAnalyticsEvent('mermaid_inline_edit_intro_shown', {
      feature_area: 'macro',
      surface: 'editor',
      macro_type: 'mermaid',
      inline_edit_diagram: candidate.type,
      inline_edit_intro_reduced_motion: reducedMotion,
    })
  }

  function onDismiss() {
    intro.value = null
  }

  return { intro, canOpen, onShown, onDismiss }
}
