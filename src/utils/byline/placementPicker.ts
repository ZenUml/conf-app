import { openModal } from '@/model/globals/forgeGlobal'
import { requestConfluenceJson as request } from '@/utils/byline/confluenceRequest'
import type { PlacementChoice } from '@/utils/byline/pagePlacement'

/**
 * The asking side of the placement picker, plus the read it draws from.
 *
 * The picker only CHOOSES. It closes with a choice and the surface that opened
 * it does the write, because that surface already owns everything around the
 * write: the record the banner reads, the reveal note, the reload, the failure
 * message, the analytics.
 */

export const PLACEMENT_PICKER_MACRO_MODE = 'placement-picker'

export interface PlacementDiagram {
  id: string
  title?: string
  diagramType: string
}

export type PlacementSurface = 'byline' | 'page_banner'

export type PlacementAnswer =
  | { status: 'chosen'; choice: PlacementChoice }
  | { status: 'cancelled' }
  | { status: 'open_failed' }

export const PICKER_OPEN_FAILED_MESSAGE =
  "Couldn't open the page preview. Try again, or copy the link and paste it into the editor."

function isPlacementChoice(payload: unknown): payload is PlacementChoice {
  const placement = (payload as PlacementChoice | undefined)?.placement
  return !!placement && Number.isInteger(placement.index) && Number.isFinite(placement.version)
}

/** Opens the picker and settles when it closes. Never rejects. */
export function choosePlacement(
  pageId: string,
  diagram: PlacementDiagram,
  surface: PlacementSurface,
): Promise<PlacementAnswer> {
  return new Promise(resolve => {
    openModal({
      resource: 'main',
      // Wide enough for a page's reading width; the byline's own 618px is not.
      size: 'xlarge',
      context: {
        macroMode: PLACEMENT_PICKER_MACRO_MODE,
        pageId,
        diagram: { id: diagram.id, title: diagram.title, diagramType: diagram.diagramType },
        surface,
      },
      onClose: (payload: unknown) => {
        resolve(isPlacementChoice(payload) ? { status: 'chosen', choice: payload } : { status: 'cancelled' })
      },
    }).catch((e: unknown) => {
      console.error('[placement-picker] failed to open', e)
      resolve({ status: 'open_failed' })
    })
  })
}

/** The placement fields of `diagram_added_to_page`. */
export function placementEventProps(choice: PlacementChoice) {
  return {
    placement_position: choice.position,
    placement_block_count: choice.blockCount,
    placement_default_kept: choice.defaultKept,
  }
}

export type PageForPlacement =
  | { status: 'ok'; title: string; version: number; content: unknown[] }
  | { status: 'forbidden' | 'failed' }

/** The published page, as the write will read it. */
export async function readPageForPlacement(pageId: string): Promise<PageForPlacement> {
  try {
    const read = await request(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=atlas_doc_format`, 'GET')
    if (read.status === 403) return { status: 'forbidden' }
    if (!read.ok) return { status: 'failed' }
    const page = await read.json()
    const version = Number(page?.version?.number)
    const content = JSON.parse(page?.body?.atlas_doc_format?.value ?? 'null')?.content
    if (!Number.isFinite(version) || !Array.isArray(content)) return { status: 'failed' }
    return { status: 'ok', title: String(page?.title ?? ''), version, content }
  } catch (e) {
    console.error('[placement-picker] page read failed', e)
    return { status: 'failed' }
  }
}
