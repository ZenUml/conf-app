// What the viewer knows about its diagram that the Comments modal needs (#1047).
//
// The edge host is installed right after the heavy components load, but the last
// editor, version, title and (sometimes) the custom content id only exist once
// the content has loaded. So the viewer publishes them here as it learns them,
// and the host reads this store when the reader CLICKS, never when it installs.
import { reactive } from 'vue'
import type { MacroTypeValue } from '@/utils/analytics/catalog'

export interface CommentsContextFields {
  /** Custom content id of the diagram. The button stays hidden until it exists. */
  diagramId?: string
  diagramVersion?: number
  diagramTitle?: string
  lastModifierId?: string
  macroType?: MacroTypeValue
}

export const commentsContext = reactive<CommentsContextFields>({})

export function publishCommentsContext(fields: CommentsContextFields): void {
  Object.assign(commentsContext, fields)
}

export function resetCommentsContext(): void {
  for (const key of Object.keys(commentsContext)) delete (commentsContext as Record<string, unknown>)[key]
}

/** A snapshot for a modal, or null while the diagram is not known yet. Undefined fields are dropped. */
export function readCommentsContext(): (CommentsContextFields & { diagramId: string }) | null {
  const { diagramId } = commentsContext
  if (!diagramId) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(commentsContext)) if (v !== undefined) out[k] = v
  return out as CommentsContextFields & { diagramId: string }
}
