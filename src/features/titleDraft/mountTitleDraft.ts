import { createApp } from 'vue'
import globals from '@/model/globals'
import { getView } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent, trackAnalyticsEventBeforeUnload } from '@/utils/analytics/trackAnalyticsEvent'
import type { AnalyticsEventName } from '@/utils/analytics/catalog'
import type { AnalyticsProperties } from '@/utils/analytics/types'
import { addDraft, type AddDraftResult } from './addDraft'
import { TITLE_DRAFT_MACRO_MODE, type TitleDraftClosePayload, type TitleDraftModalContext } from './constants'
import TitleDraftPanel from './TitleDraftPanel.vue'
import { titleDraftProps } from './offerProps'
import { readTitleDraftCopyExposure } from './copyExperiment'

// Telemetry cannot leave a failed preview or completed save stuck open.
export const TITLE_DRAFT_TELEMETRY_TIMEOUT_MS = 750

/** Mounts the preview into the Forge modal the page banner opened. */
export function mountTitleDraftModal(forgeContext: Record<string, any>): boolean {
  const modal = (forgeContext?.extension?.modal ?? {}) as TitleDraftModalContext
  if (modal.macroMode !== TITLE_DRAFT_MACRO_MODE || !modal.mermaid || !modal.pageId) return false
  const container = document.getElementById('app')
  if (!container) throw new Error('Title draft modal root not found')

  const exposure = readTitleDraftCopyExposure(modal.copyExperiment)
  const props = { ...titleDraftProps(modal.kind, modal.confidence, exposure), surface: 'modal' as const, page_id: modal.pageId }
  // Observability must never turn a successful render/save into a UI failure.
  const track = (event: AnalyticsEventName, extra: AnalyticsProperties = {}) => {
    try { trackAnalyticsEvent(event, { ...props, ...extra }) } catch { /* analytics is best effort */ }
  }
  const trackBeforeClose = async (event: AnalyticsEventName): Promise<void> => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        trackAnalyticsEventBeforeUnload(event, props),
        new Promise<void>(resolve => { timeout = setTimeout(resolve, TITLE_DRAFT_TELEMETRY_TIMEOUT_MS) }),
      ])
    } catch { /* still close if telemetry fails */ }
    finally { if (timeout) clearTimeout(timeout) }
  }
  let pendingAddClick: Promise<void> | undefined
  const onClose = async (payload: TitleDraftClosePayload) => {
    await pendingAddClick
    await (await getView()).close(payload)
  }
  const add = async (): Promise<AddDraftResult> => {
    await globals.apWrapper.initializeContext()
    const outcome = await addDraft(modal.pageId, modal.pageTitle, modal.mermaid)
    if (outcome.result === 'added') await trackBeforeClose('title_draft_added')
    else track('title_draft_add_failed', { title_draft_failure: outcome.result })
    return outcome
  }

  createApp(TitleDraftPanel, {
    mermaid: modal.mermaid, add, onClose,
    onPreviewMounted: () => track('title_draft_preview_mounted'),
    onPreviewRendered: () => track('title_draft_preview_rendered'),
    // Queue the beacon before context/save work, without delaying that work.
    onAddClicked: () => { pendingAddClick = trackBeforeClose('title_draft_add_clicked') },
    onPreviewRenderFailed: () => trackBeforeClose('title_draft_preview_render_failed'),
  }).mount(container)
  return true
}
