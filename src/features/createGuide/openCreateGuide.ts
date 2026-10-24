import { openModal as forgeOpenModal } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { CreateGuideCloseMethod, CreateGuideVariant, MacroTypeValue } from '@/utils/analytics/catalog'

import { CREATE_GUIDE_MACRO_MODE } from './constants'

export { CREATE_GUIDE_MACRO_MODE }

/** What the guide passes to `view.close()` when it closes itself. */
export type CreateGuideClosePayload = { method: Exclude<CreateGuideCloseMethod, 'host'> }

interface OpenCreateGuideOptions {
  variant: CreateGuideVariant
  macroType: MacroTypeValue
  hasEditPermission: boolean
  openModal?: (options: Record<string, unknown>) => Promise<unknown>
  now?: () => number
}

let guideOpen = false

function closeMethod(payload: unknown): CreateGuideCloseMethod {
  const method = (payload as { method?: unknown } | null | undefined)?.method
  return method === 'button' || method === 'escape' ? method : 'host'
}

/**
 * Opens the slash-command creation guide in an untitled Forge medium modal (600 × 520, no
 * Atlassian header, measured 2026-10-02). The guide closes itself; a blanket click or an
 * Escape that Confluence handles reaches onClose without a payload and counts as `host`.
 */
export async function openCreateGuide({
  variant,
  macroType,
  hasEditPermission,
  openModal = forgeOpenModal,
  now = Date.now,
}: OpenCreateGuideOptions): Promise<void> {
  if (guideOpen) return
  guideOpen = true

  const base = { feature_area: 'macro' as const, macro_type: macroType, create_guide_variant: variant }
  trackAnalyticsEvent('create_guide_opened', { ...base, surface: 'viewer', has_edit_permission: hasEditPermission })

  let openedAt: number | undefined
  try {
    await openModal({
      resource: 'main',
      size: 'medium',
      title: '',
      closeOnEscape: true,
      closeOnOverlayClick: true,
      context: { macroMode: CREATE_GUIDE_MACRO_MODE, createGuideVariant: variant },
      onClose: (payload?: unknown) => {
        guideOpen = false
        trackAnalyticsEvent('create_guide_closed', {
          ...base,
          surface: 'modal',
          create_guide_close_method: closeMethod(payload),
          ...(openedAt === undefined ? {} : { create_guide_watched_ms: Math.max(0, Math.round(now() - openedAt)) }),
        })
      },
    })
    openedAt = now()
  } catch (error) {
    guideOpen = false
    trackAnalyticsEvent('create_guide_open_failed', {
      ...base,
      surface: 'viewer',
      failure_reason: error instanceof Error ? error.message : String(error),
    })
  }
}

export function resetCreateGuideForTests(): void {
  guideOpen = false
}
