import { createApp } from 'vue'
import { getView } from '@/model/globals/forgeGlobal'
import type { CreateGuideVariant } from '@/utils/analytics/catalog'
import CreateGuideModal from './CreateGuideModal.vue'
import { CREATE_GUIDE_MACRO_MODE } from './constants'
import type { CreateGuideClosePayload } from './openCreateGuide'

const VARIANTS: readonly CreateGuideVariant[] = ['zenuml', 'graph', 'api']

/**
 * Mounts the creation guide into a Forge modal opened by openCreateGuide(). The payload
 * passed to view.close() reaches the opener's onClose, which records how it closed.
 */
export function mountCreateGuideModal(forgeContext: Record<string, any>): boolean {
  const modal = forgeContext?.extension?.modal ?? {}
  if (modal.macroMode !== CREATE_GUIDE_MACRO_MODE) return false
  const container = document.getElementById('app')
  if (!container) throw new Error('Create guide modal root not found')
  const variant: CreateGuideVariant = VARIANTS.includes(modal.createGuideVariant) ? modal.createGuideVariant : 'zenuml'
  const onClose = async (payload: CreateGuideClosePayload) => { await (await getView()).close(payload) }
  createApp(CreateGuideModal, { variant, onClose }).mount(container)
  return true
}
