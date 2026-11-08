export interface PageRange {
  start: number
  end: number
}

/** Pack complete rows into each page, preserving the Hub's order. */
export function paginateRows(heights: readonly number[], availableHeight: number): PageRange[] {
  if (!heights.length) return []
  // No layout information is available in a headless renderer. Keep all rows visible.
  if (availableHeight <= 0) return [{ start: 0, end: heights.length }]

  const pages: PageRange[] = []
  let start = 0
  let used = 0
  for (let index = 0; index < heights.length; index++) {
    const height = Math.max(1, heights[index] ?? 1)
    if (index > start && used + height > availableHeight + 0.5) {
      pages.push({ start, end: index })
      start = index
      used = 0
    }
    used += height
  }
  pages.push({ start, end: heights.length })
  return pages
}

export function pageContaining(pages: readonly PageRange[], index: number): number {
  const found = pages.findIndex(({ start, end }) => index >= start && index < end)
  return found < 0 ? Math.max(0, pages.length - 1) : found
}
