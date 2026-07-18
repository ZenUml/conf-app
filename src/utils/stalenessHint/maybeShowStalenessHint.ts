import { DRIFT_THRESHOLD, isDismissalActive, isInlineEditorRender, readDismissMarker } from './core'
import { getDrift } from './drift'
import { isStalenessHintEnabled } from './flags'
import { mountStalenessHint } from './hint'

/** v1 scope: diagram types with a meaningful in-place "update" job. */
const HINT_MACRO_TYPES = new Set(['sequence', 'mermaid', 'plantuml', 'graph'])

export interface StalenessHintInput {
  context: any
  macroType: string
  ccId: string
  ccLastModified: string
  ccAuthorId: string | undefined
  onCta: () => void
}

/**
 * Single decision entry, called fire-and-forget from forgeIndex after the
 * custom content loads. Gate order is cheapest-first; the drift fetch only
 * runs after surface/type/dismissal/flag all pass. Never throws.
 */
export async function maybeShowStalenessHint(input: StalenessHintInput): Promise<void> {
  try {
    if (!isInlineEditorRender(input.context)) return
    if (!HINT_MACRO_TYPES.has(input.macroType)) return
    if (!input.ccId || !input.ccLastModified) return
    if (isDismissalActive(readDismissMarker(input.ccId))) return
    if (!(await isStalenessHintEnabled())) return

    const pageId = input.context?.extension?.content?.id
    const pageVersion = Number(input.context?.extension?.content?.version)
    if (!pageId || !Number.isFinite(pageVersion)) return

    const drift = await getDrift(String(pageId), pageVersion, input.ccLastModified)
    if (drift < DRIFT_THRESHOLD) return

    mountStalenessHint({
      drift,
      isDiagramAuthor: !!input.ccAuthorId && input.ccAuthorId === input.context?.accountId,
      macroType: input.macroType,
      ccId: input.ccId,
      onCta: input.onCta,
    })
  } catch (e) {
    console.debug('[staleness-hint] skipped', e)
  }
}
