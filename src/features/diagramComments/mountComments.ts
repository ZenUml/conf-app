import { createApp } from 'vue'
import type { MacroTypeValue } from '@/utils/analytics/catalog'
import DiagramCommentsPanel from './DiagramCommentsPanel.vue'

import { COMMENTS_MACRO_MODE } from './commentsMode'

export { COMMENTS_MACRO_MODE, isCommentsModalContext } from './commentsMode'

/** What the edge button hands the modal. Built at click time from the viewer's published context. */
export interface CommentsModalContext {
  pageId: string
  pageUrl: string
  localId?: string
  diagramId: string
  diagramVersion?: number
  diagramTitle?: string
  lastModifierId?: string
  currentAccountId?: string
  macroType?: MacroTypeValue
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== ''

function readContext(value: unknown): CommentsModalContext | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Partial<CommentsModalContext>
  if (!nonEmpty(c.pageId) || !nonEmpty(c.pageUrl) || !nonEmpty(c.diagramId)) return null
  return c as CommentsModalContext
}

/**
 * Mount the panel in the Comments modal. Returns false when the modal context is
 * unusable; the caller still treats the iframe as handled, so nothing else (the
 * viewer, the edge host) boots inside the modal.
 */
export function mountCommentsModal(forgeContext: Record<string, any>): boolean {
  const modal = forgeContext?.extension?.modal ?? {}
  if (modal.macroMode !== COMMENTS_MACRO_MODE) return false
  const context = readContext(modal.commentsContext)
  if (!context) return false
  const container = document.getElementById('app')
  if (!container) throw new Error('Comments modal root not found')
  createApp(DiagramCommentsPanel, {
    pageId: context.pageId,
    pageUrl: context.pageUrl,
    diagramId: context.diagramId,
    localId: context.localId,
    diagramVersion: context.diagramVersion,
    diagramTitle: context.diagramTitle,
    lastModifierId: context.lastModifierId,
    currentAccountId: context.currentAccountId,
    macroType: context.macroType,
    closable: false,
  }).mount(container)
  return true
}
