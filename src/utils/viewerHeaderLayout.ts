/**
 * Staged collapse for the inline viewer header (Claude Design prototype
 * "viewer-header-prototype", 2026-10). The header gives up action labels in a
 * fixed order until the title has room again, instead of collapsing at fixed
 * container-query breakpoints that ignored how long the title actually is:
 *
 *   stage 0  every label shown
 *   stage 1  Edit and Refined become icon-only
 *   stage 2  Fullscreen becomes icon-only
 *   stage 3  Source and Copy for AI move into the More (⋯) menu
 *            (only when the diagram has source; otherwise stage 2 is the last)
 *
 * The chosen stage is the smallest one at which the title shows at least
 * min(MIN_TITLE_CHARS, title.length) characters. Everything here is pure: the
 * component injects text measurement (canvas measureText in the browser) and
 * the space the title gets at each stage.
 */

export type HeaderStage = 0 | 1 | 2 | 3

export const MIN_TITLE_CHARS = 24

export const HEADER_STAGE_NAMES: Record<HeaderStage, string> = {
  0: 'all labels',
  1: 'Edit + Refined → icon',
  2: 'Fullscreen → icon',
  3: 'Source + Copy for AI → More',
}

/** What the header contains — only the parts whose width depends on the stage. */
export interface HeaderModel {
  /** Source + Copy for AI are present (text-DSL diagram types). */
  hasSource: boolean
  /** The Refined (Magic) toggle is present. */
  magic: boolean
  /** Diagram page count; page navigation shows when > 1. */
  pages: number
  /** The Edit button is present. */
  hasEdit: boolean
}

/** Width in px of a button label at the given font size (500 weight). */
export type MeasureLabel = (text: string, size: 12 | 13) => number
/** Width in px of title text (600 14px). */
export type MeasureTitle = (text: string) => number

// Geometry from the prototype: 28px square icon buttons, 6px between
// controls, 2px inside a split button or the page-nav group.
const ICON = 28
const GAP = 6
const SEPARATOR = 1

export function maxHeaderStage(model: Pick<HeaderModel, 'hasSource'>): HeaderStage {
  return model.hasSource ? 3 : 2
}

/**
 * Width of the controls to the right of the title at a given stage. Inline
 * zoom is not part of the header (it lives in each renderer's viewport), so the
 * prototype's zoom group is not counted.
 */
export function controlsWidth(model: HeaderModel, stage: HeaderStage, measureLabel: MeasureLabel): number {
  const parts: number[] = []
  if (model.magic) {
    // 1px border + 8px padding each side, 16px icon, 5px gap, "Refined" label.
    parts.push(stage < 1 ? 2 + 8 + 16 + 5 + measureLabel('Refined', 12) + 8 : ICON)
  }
  if (model.pages > 1) {
    // prev + "1 of N" (6px padding each side) + next, 2px apart.
    parts.push(ICON + 2 + 12 + measureLabel(`1 of ${model.pages}`, 12) + 2 + ICON)
  }
  const toolbar: number[] = []
  if (model.hasSource && stage < 3) {
    // Source icon, 2px, Copy for AI split (28px icon + 18px chevron), separator.
    toolbar.push(ICON + 2 + ICON + 18, SEPARATOR)
  }
  toolbar.push(ICON) // More
  if (model.hasEdit) {
    // 8px padding + 1px border each side, 16px icon, 6px gap, label.
    toolbar.push(stage < 1 ? 40 + measureLabel('Edit', 13) : ICON)
  }
  // 10px padding each side, 16px icon, 6px gap, label.
  toolbar.push(stage < 2 ? 42 + measureLabel('Fullscreen', 13) : ICON)
  parts.push(sum(toolbar) + GAP * (toolbar.length - 1))
  return sum(parts) + GAP * (parts.length - 1)
}

/** How many title characters are visible in `width` px, ellipsis included. */
export function visibleTitleChars(title: string, width: number, measureTitle: MeasureTitle): number {
  if (measureTitle(title) <= width) return title.length
  let lo = 0
  let hi = title.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measureTitle(title.slice(0, mid) + '…') <= width) lo = mid
    else hi = mid - 1
  }
  return lo
}

export interface HeaderStageResult {
  stage: HeaderStage
  /** Title characters visible at that stage. */
  chars: number
  /** Width in px the title gets at that stage (never negative). */
  titleSpace: number
}

export function pickHeaderStage(options: {
  title: string
  maxStage: HeaderStage
  measureTitle: MeasureTitle
  /** Width available to the title at each stage, in px. */
  titleSpaceAt: (stage: HeaderStage) => number
  minChars?: number
}): HeaderStageResult {
  const { title, maxStage, measureTitle, titleSpaceAt } = options
  const need = Math.min(options.minChars ?? MIN_TITLE_CHARS, title.length)
  let result: HeaderStageResult = { stage: 0, chars: 0, titleSpace: 0 }
  for (let s = 0; s <= maxStage; s++) {
    const stage = s as HeaderStage
    const titleSpace = Math.max(0, Math.round(titleSpaceAt(stage)))
    const chars = visibleTitleChars(title, titleSpace, measureTitle)
    result = { stage, chars, titleSpace }
    if (chars >= need) break
  }
  return result
}

export type MoreMenuItemId =
  | 'source'
  | 'copy-for-ai'
  | 'separator'
  | 'copy-diagram-link'
  | 'copy-page-link'
  | 'export-png'
  | 'versions'
  | 'debug'

/**
 * Contents of the header More (⋯) menu, top to bottom. Inline, it holds the
 * actions the bottom pill used to carry, led by Source and Copy for AI once
 * stage 3 moves them out of the toolbar. Fullscreen shows those actions as
 * header buttons, so its menu holds only Download debug info.
 */
export function moreMenuItems(options: {
  stage: HeaderStage
  hasSource: boolean
  isCustomContent: boolean
  hasDeeplinkHost: boolean
  fullscreen: boolean
}): MoreMenuItemId[] {
  if (options.fullscreen) return ['debug']
  const items: MoreMenuItemId[] = []
  if (options.stage >= 3 && options.hasSource) items.push('source', 'copy-for-ai', 'separator')
  if (options.isCustomContent && options.hasDeeplinkHost) items.push('copy-diagram-link')
  items.push('copy-page-link', 'export-png')
  if (options.isCustomContent) items.push('versions')
  items.push('separator', 'debug')
  return items
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
