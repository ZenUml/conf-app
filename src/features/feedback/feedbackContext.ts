import type { Diagram } from '@/model/Diagram/Diagram'
import type { MacroTypeValue } from '@/utils/analytics/catalog'
import type { FeedbackContext, FeedbackSurface } from './feedbackSession'

type ForgeLikeContext = Record<string, any>

const NA = 'not_applicable'
const UNAVAILABLE = 'unavailable'
const UNTITLED_DIAGRAM = 'Untitled diagram'

export function feedbackSurfaceForContext(context: ForgeLikeContext): FeedbackSurface | null {
  const moduleKey = String(context?.moduleKey ?? '')
  const extension = context?.extension ?? {}
  const macroMode = extension?.modal?.macroMode
  const feedbackSurface = context?.feedbackSurface ?? extension?.modal?.feedbackSurface

  if (
    extension.type === 'confluence:contentBylineItem'
    || extension.type === 'confluence:pageBanner'
    || moduleKey === 'zenuml-page-banner'
    || moduleKey === 'zenuml-unplaced-banner'
    || macroMode === 'feedback'
  ) return null

  if (feedbackSurface === 'png_export') return 'png_export'

  if (macroMode === 'editor' || extension?.macro?.isConfiguring || extension?.macro?.isInserting) return 'editor'
  if (macroMode === 'fullscreen') return 'fullscreen'
  if (extension.type === 'confluence:globalSettings') return 'get_started'
  if (extension.type === 'confluence:globalPage' || extension.type === 'confluence:spacePage') return 'dashboard'
  if (extension.type === 'confluence:macro' || moduleKey.includes('macro')) return 'viewer'
  return null
}

function clientDomain(context: ForgeLikeContext): string {
  const raw = context?.siteUrl ?? context?.extension?.location
  if (typeof raw !== 'string') return UNAVAILABLE
  try {
    const host = new URL(raw).hostname
    return host.endsWith('.atlassian.net') ? host.slice(0, -'.atlassian.net'.length) : host
  } catch {
    return UNAVAILABLE
  }
}

function diagramTitleFor(title: unknown): string {
  const raw = typeof title === 'string' ? title : ''
  return raw.trim() ? raw : UNTITLED_DIAGRAM
}

function normalizeDiagramType(value: unknown): MacroTypeValue | 'unavailable' {
  const type = String(value ?? '').toLowerCase()
  if (type === 'openapi') return 'openapi'
  if (type === 'asyncapi') return 'asyncapi'
  if (['sequence', 'mermaid', 'plantuml', 'graph', 'embed'].includes(type)) return type as MacroTypeValue
  return UNAVAILABLE
}

export function deriveFeedbackContext(context: ForgeLikeContext, diagram?: Partial<Diagram>): FeedbackContext {
  const surface = feedbackSurfaceForContext(context)
  if (!surface) throw new Error('Feedback is unavailable on this surface')
  const globalSurface = surface === 'get_started' || surface === 'dashboard'
  const modal = context?.extension?.modal ?? {}
  const config = context?.extension?.config ?? {}
  const space = context?.extension?.space ?? {}

  return {
    surface,
    hostModule: String(context?.moduleKey || UNAVAILABLE),
    diagramType: globalSurface ? NA : normalizeDiagramType(diagram?.diagramType ?? modal.diagramType),
    diagramTitle: globalSurface ? NA : diagramTitleFor(diagram?.title),
    userAccountId: String(context?.accountId || UNAVAILABLE),
    clientDomain: clientDomain(context),
    spaceName: globalSurface ? NA : String(space?.name || space?.key || UNAVAILABLE),
    macroUuid: globalSurface
      ? NA
      : String(context?.localId || config.uuid || modal.macro_uuid || UNAVAILABLE),
    contentId: globalSurface
      ? NA
      : String(context?.contentId || context?.extension?.content?.id || modal.contentId || modal.pageId || UNAVAILABLE),
    customContentId: globalSurface
      ? NA
      : String(diagram?.id || modal.customContentId || config.customContentId || UNAVAILABLE),
  }
}
