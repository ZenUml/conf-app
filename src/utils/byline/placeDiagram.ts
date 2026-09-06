import { addDiagramToPage, reloadHostPage } from '@/utils/byline/addToPage'
import { cancelReveal, requestReveal } from '@/utils/byline/revealDiagram'

/**
 * The one-click place, minus the surface.
 *
 * The banner and the byline row offer the same action and were running the same
 * six steps in two files: call, report, decide what the outcome says about this
 * user, leave the reveal note, reload, drop the note if the reload never
 * happened. Two copies of an ordering that matters — the note has to be written
 * before the reload and withdrawn when it does not come — is one copy too many;
 * the `failed` case had already drifted apart between them once.
 *
 * What stays with each surface is what each surface says: the banner writes a
 * sentence into its own hint line, the byline row just re-labels itself. This
 * returns the facts to say it with.
 */
export interface PlaceOutcome {
  /** The raw result, for anything a surface wants to branch on itself. */
  result: 'added' | 'already_present' | 'forbidden' | 'conflict' | 'failed'
  /** Macros on the page after the write, when the write got far enough to count. */
  pageMacroCount?: number
  /** The page's stored ADF now carries the macro (a new version was published). */
  placed: boolean
  /**
   * This user cannot edit this page — a durable answer, so the surface should
   * stop offering the action and hand over the link instead.
   *
   * ONLY 'forbidden' sets this. 'failed' is a 500 or a dropped connection and
   * says nothing about permission; treating the two alike took the button off
   * every remaining row for the life of an iframe after one blip.
   */
  refused: boolean
  /** What to tell the user, or null when there is nothing to say. */
  message: string | null
}

const MESSAGES: Record<string, string | null> = {
  added: null,
  already_present: null,
  forbidden:
    'You do not have permission to edit this page — copy the link and send it to someone who does.',
  conflict: 'Someone edited the page while we were adding it. Reload and try again.',
  failed: "Couldn't add it to the page. Try again, or copy the link and paste it into the editor.",
}

/**
 * Place `customContentId` on `pageId`, then reload the host page so the user
 * can see it.
 *
 * The reload runs on every successful write, not just the last of several: a
 * place that does not reload looks like it did nothing, which is the whole
 * reason it exists. `onPlaced` runs BEFORE the reload — it is where a surface
 * rewrites the record the reloaded page will read, and the reload would
 * otherwise race it.
 */
export async function placeDiagram(
  pageId: string,
  diagram: { id: string; diagramType: string },
  onPlaced?: () => void | Promise<void>,
): Promise<PlaceOutcome> {
  const { result, pageMacroCount } = await addDiagramToPage(pageId, diagram)
  const outcome: PlaceOutcome = {
    result,
    pageMacroCount,
    placed: result === 'added' || result === 'already_present',
    refused: result === 'forbidden',
    message: MESSAGES[result] ?? null,
  }
  if (!outcome.placed) return outcome

  await onPlaced?.()

  // 'already_present' wrote nothing, so there is nothing new to show.
  if (result === 'added') {
    // The note the placed macro claims on the far side of the reload. Written
    // first, withdrawn if the reload never happens — a note nobody can claim
    // would scroll the NEXT page load instead.
    requestReveal(pageId, diagram.id)
    if (!(await reloadHostPage())) cancelReveal()
  }
  return outcome
}
