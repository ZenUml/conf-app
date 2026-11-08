import { createApp } from 'vue'
import { getView } from '@/model/globals/forgeGlobal'
import type { PlacementChoice } from '@/utils/byline/pagePlacement'
import PlacementPicker from './PlacementPicker.vue'

/** The modal half of utils/byline/placementPicker.ts. */
export function mountPlacementPicker(forgeContext: Record<string, any>): boolean {
  const modal = forgeContext?.extension?.modal ?? {}
  if (typeof modal.pageId !== 'string' || !modal.diagram?.id) return false
  const container = document.getElementById('app')
  if (!container) throw new Error('Placement picker root not found')

  const close = async (choice?: PlacementChoice) => {
    const view = await getView()
    await view.close(choice)
  }

  createApp(PlacementPicker, {
    pageId: modal.pageId,
    diagram: modal.diagram,
    surface: modal.surface,
    onChoose: close,
    onDismiss: () => close(),
  }).mount(container)
  return true
}
