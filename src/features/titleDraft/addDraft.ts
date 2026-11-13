import globals from '@/model/globals'
import { DataSource, Diagram, DiagramType } from '@/model/Diagram/Diagram'
import { addTitleDraftToPage } from './insertAtTop'
import { discardCustomContent } from './undo'

export type AddDraftResult =
  | { result: 'added'; contentId: string }
  | { result: 'already_added' | 'forbidden' | 'conflict' | 'failed' | 'save_failed' }

/** The diagram as stored: a new Mermaid diagram the viewer marks until its first edit. */
export function draftToDiagram(mermaid: string, pageTitle: string): Diagram {
  const diagram = new Diagram()
  diagram.diagramType = DiagramType.Mermaid
  diagram.title = pageTitle
  diagram.source = DataSource.Unknown
  diagram.isNew = true
  diagram.mermaidCode = mermaid
  diagram.titleDraftPristine = true
  return diagram
}

/**
 * Save the diagram, then place it at the top of the page.
 *
 * The custom content must exist before the macro can reference it, so a viewer
 * who loses the race to another viewer has already created one: it is removed
 * here, otherwise each lost race would leave an unplaced diagram on the page.
 */
export async function addDraft(pageId: string, pageTitle: string, mermaid: string): Promise<AddDraftResult> {
  let contentId: string | undefined
  try {
    const saved = await globals.apWrapper.createCustomContentV2(draftToDiagram(mermaid, pageTitle))
    contentId = saved?.id ? String(saved.id) : undefined
  } catch (e) {
    console.error('[title-draft] save failed', e)
  }
  if (!contentId) return { result: 'save_failed' }

  const placed = await addTitleDraftToPage(pageId, { id: contentId, diagramType: DiagramType.Mermaid })
  if (placed.result === 'added') return { result: 'added', contentId }
  await discardCustomContent(contentId)
  return { result: placed.result }
}
