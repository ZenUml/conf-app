/**
 * Whether an AsyncAPI dashboard document matches a search term.
 *
 * Intentionally matches ONLY the user-facing title + description — NOT the
 * raw spec body (`code`). Every AsyncAPI spec shares the same YAML vocabulary
 * (channels, operations, info, payload, version, …), so searching the body
 * made any such term match nearly every document and the search appeared to
 * do nothing. Title + description are what the dashboard card actually shows.
 *
 * `code` is part of the accepted shape only to make the "don't search the raw
 * body" contract explicit and regression-testable.
 */
export interface SearchableDoc {
  displayTitle?: string
  description?: string
  code?: string
}

export function docMatchesSearch(doc: SearchableDoc, rawTerm: string): boolean {
  const term = rawTerm.trim().toLowerCase()
  if (!term) return true
  return (
    (doc.displayTitle || '').toLowerCase().includes(term) ||
    (doc.description || '').toLowerCase().includes(term)
  )
}
