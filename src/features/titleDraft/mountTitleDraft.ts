import { createApp } from 'vue'
import globals from '@/model/globals'
import { getView } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { addDraft, type AddDraftResult } from './addDraft'
import { TITLE_DRAFT_MACRO_MODE, type TitleDraftClosePayload, type TitleDraftModalContext } from './constants'
import TitleDraftPanel from './TitleDraftPanel.vue'
import { titleDraftProps } from './offerProps'

/** Mounts the preview into the Forge modal the page banner opened. */
export function mountTitleDraftModal(forgeContext: Record<string, any>): boolean {
  const modal = (forgeContext?.extension?.modal ?? {}) as TitleDraftModalContext
  if (modal.macroMode !== TITLE_DRAFT_MACRO_MODE || !modal.mermaid || !modal.pageId) return false
  const container = document.getElementById('app')
  if (!container) throw new Error('Title draft modal root not found')

  const props = titleDraftProps(modal.kind, modal.confidence)
  const onClose = async (payload: TitleDraftClosePayload) => { await (await getView()).close(payload) }
  const add = async (): Promise<AddDraftResult> => {
    await globals.apWrapper.initializeContext()
    const outcome = await addDraft(modal.pageId, modal.pageTitle, modal.mermaid)
    if (outcome.result === 'added') trackAnalyticsEvent('title_draft_added', props)
    else trackAnalyticsEvent('title_draft_add_failed', { ...props, title_draft_failure: outcome.result })
    return outcome
  }

  createApp(TitleDraftPanel, { mermaid: modal.mermaid, add, onClose }).mount(container)
  return true
}
