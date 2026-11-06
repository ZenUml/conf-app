/**
 * What the byline calls the things it lists, per variant.
 *
 * The AsyncAPI app's byline offers only OpenAPI and AsyncAPI (pickerTypes.ts)
 * and is titled "API Docs" in its manifest (the asyncapi edit in
 * scripts/forge-wizard.mjs). Its panel and banner say "API doc" so the copy
 * matches the title the user clicked. Every other variant keeps "diagram".
 */
export interface BylineNoun {
  /** "diagram" / "API doc" — mid-sentence, singular. */
  one: string
  /** "diagrams" / "API docs" — mid-sentence, plural. */
  many: string
  /** With its article: "a diagram" / "an API doc". */
  aOne: string
  /** The byline item's own title, as the user sees it under the page title. */
  title: string
  /** How one is made: a diagram is drawn, a spec is written. */
  make: string
}

const DIAGRAM: BylineNoun = { one: 'diagram', many: 'diagrams', aOne: 'a diagram', title: 'Diagrams', make: 'Draw' }
const API_DOC: BylineNoun = { one: 'API doc', many: 'API docs', aOne: 'an API doc', title: 'API Docs', make: 'Write' }

export function bylineNounFor(productType: string | undefined): BylineNoun {
  return productType === 'asyncapi' ? API_DOC : DIAGRAM
}

/** Capitalise the first letter, for a noun that opens a sentence or heading. */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
