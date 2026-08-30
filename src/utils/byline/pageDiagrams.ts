import { DiagramType, getDiagramData } from '@/model/Diagram/Diagram'

/**
 * Lite byline (docs/superpowers/specs/2026-07-25-lite-byline-activation-design.md).
 *
 * The byline modal opens on EVERY page, most of which have no diagram at all,
 * so this module's job is to turn a page's custom-content children into a list
 * the modal can render — and to say "none" cleanly, which is the common case.
 *
 * Parsing is kept pure and separate from the fetch so the failure modes that
 * actually occur in customer data (malformed body JSON, a body with no
 * recognizable type, a child with no title) are unit-testable without a Forge
 * context. A single unparseable child must never take the whole list down: the
 * modal degrades to listing the rest.
 */

/** Diagram types whose stored source is text a user can meaningfully copy.
 *  Graph (DrawIO XML) and the API specs are excluded — copying raw XML or a
 *  whole spec out of a byline popup is not a coherent affordance. Mirrors the
 *  View Source panel's text-DSL-only scope (#333). */
const COPYABLE_TYPES: ReadonlyArray<string> = [
  DiagramType.Sequence,
  DiagramType.Mermaid,
  DiagramType.PlantUml,
]

export interface PageDiagram {
  /** Custom content id — stable, used as the list key. */
  id: string
  /** Custom content title. Falls back to a type label; never empty. */
  title: string
  /** Normalized diagram type, or 'unknown' when the body doesn't declare one. */
  diagramType: string
  /** Stored source, empty string when the type has no copyable text form. */
  source: string
  /** Whether the modal should offer "Copy source" for this entry. */
  copyable: boolean
  /** Custom content's own `createdAt` (ISO-8601, UTC), '' when absent. NOT
   *  `version.createdAt`, which is the current version's timestamp — i.e. the
   *  last edit, which for an edited diagram is not when it was created. */
  createdAt: string
}

/**
 * The ONE user-facing name per diagram type, for every byline surface.
 *
 * The picker and the list used to name types from separate tables, so a tile
 * labelled "Flowchart" created a card labelled "MERMAID" — the user picked one
 * thing and was shown another, with no way to tell they were the same. The
 * picker's names win because they are the ones a user reads before they know
 * what our types are called: Mermaid and PlantUML are two dialects behind a
 * single "Flowchart" choice (they share one macro), so both resolve to it here.
 *
 * `BylineDiagrams.vue` builds its picker names from this table too — anything
 * that needs a type's name must go through `typeLabel`, never a local literal.
 */
const TYPE_LABELS: Record<string, string> = {
  [DiagramType.Sequence]: 'Sequence',
  [DiagramType.Mermaid]: 'Flowchart',
  [DiagramType.PlantUml]: 'Flowchart',
  [DiagramType.Graph]: 'Graph',
  [DiagramType.OpenApi]: 'OpenAPI',
  [DiagramType.AsyncApi]: 'AsyncAPI',
  [DiagramType.Embed]: 'Embed',
}

/**
 * Both tables in this file are keyed on the `DiagramType` enum, and two of its
 * members are not spelled the way the app stores them: the enum says `OpenAPI`
 * and `AsyncAPI` while real custom-content bodies store `openapi` / `asyncapi`.
 * Verified on lite-dev 2026-08-21 — custom content 67600411 ("Demo · OpenAPI")
 * carries `{"diagramType":"openapi"}`, while sequence / mermaid / graph store
 * values that already match their enum members exactly.
 *
 * An exact-match lookup therefore misses on OpenAPI and AsyncAPI, and every
 * caller silently degrades: `typeLabel` returns "Diagram" and `toMacroType`
 * returns "none", so an OpenAPI diagram reads as an untyped one on the byline
 * and its events land in the catch-all analytics bucket. Fold the key instead
 * of casting one spelling to the other, so both spellings resolve and an
 * unrecognised type still reaches the fallback.
 */
function lookup(table: Record<string, string>, diagramType: string): string | undefined {
  const exact = table[diagramType]
  if (exact) return exact
  const folded = String(diagramType ?? '').toLowerCase()
  const key = Object.keys(table).find((k) => k.toLowerCase() === folded)
  return key ? table[key] : undefined
}

export function typeLabel(diagramType: string): string {
  return lookup(TYPE_LABELS, diagramType) || 'Diagram'
}

/**
 * Stored `diagramType` values are not the analytics vocabulary: the body says
 * `OpenAPI` / `AsyncAPI` while `MacroTypeValue` in the catalog is all lowercase.
 * Casting one to the other would quietly put `OpenAPI` in Mixpanel next to
 * `openapi` from every other surface and split the same macro type across two
 * buckets. Anything unrecognised becomes `none`, which the catalog already
 * defines, rather than a novel value.
 */
const MACRO_TYPE_BY_DIAGRAM_TYPE: Record<string, string> = {
  [DiagramType.Sequence]: 'sequence',
  [DiagramType.Mermaid]: 'mermaid',
  [DiagramType.PlantUml]: 'plantuml',
  [DiagramType.Graph]: 'graph',
  [DiagramType.OpenApi]: 'openapi',
  [DiagramType.AsyncApi]: 'asyncapi',
  [DiagramType.Embed]: 'embed',
}

export function toMacroType(diagramType: string): string {
  return lookup(MACRO_TYPE_BY_DIAGRAM_TYPE, diagramType) || 'none'
}

/**
 * The `diagramType` to hand `openModal` so forgeIndex routes the modal to the
 * right viewer.
 *
 * A modal opened from the byline carries `moduleKey: 'zenuml-byline-diagrams'`,
 * not a macro key, so every moduleKey-based discriminator in forgeIndex misses
 * and `extension.modal.diagramType` is the only signal left. Two consequences:
 *
 * - The whole text-DSL family maps to `sequence`. `isSequenceFamilyEntry`
 *   recognises only `sequence` and `mermaid` as modal types, so a plantuml
 *   diagram announced as `plantuml` would fall through the routing chain to the
 *   swagger viewer. They share one macro anyway, and the renderer is chosen
 *   from the loaded document's own `diagramType`, so the family name is the
 *   correct routing hint.
 * - Everything else passes through lowercased to match what forgeIndex compares
 *   against.
 */
const MODAL_ROUTING_TYPE: Record<string, string> = {
  [DiagramType.Sequence]: 'sequence',
  [DiagramType.Mermaid]: 'mermaid',
  [DiagramType.PlantUml]: 'sequence',
  [DiagramType.Graph]: 'graph',
  [DiagramType.OpenApi]: 'openapi',
  [DiagramType.AsyncApi]: 'asyncapi',
  [DiagramType.Embed]: 'embed',
}

export function toModalDiagramType(diagramType: string): string {
  // Through `lookup`, not a bare index, for the reason its docblock gives: real
  // stored bodies spell these `openapi` / `asyncapi` while the enum members are
  // `OpenAPI` / `AsyncAPI`, so an exact-match index MISSES on exactly the two
  // types that route by modal.diagramType and nothing else. The miss was silent
  // and total — it fell through to 'sequence', so opening an OpenAPI diagram
  // from the byline list handed the sequence viewer a swagger document. The
  // sibling tables in this file already fold; this one was left behind.
  return lookup(MODAL_ROUTING_TYPE, diagramType) || 'sequence'
}

/**
 * Turn raw `/api/v2/pages/{id}/custom-content?body-format=raw` responses into
 * the modal's list. Accepts the array of responses (one per probed content
 * type) exactly as the REST layer returns them, including error-shaped ones.
 */
export function parsePageDiagrams(responses: Array<any>): PageDiagram[] {
  const out: PageDiagram[] = []
  const seen = new Set<string>()

  for (const response of responses || []) {
    // An errored response contributes nothing but must not abort the others —
    // one content type 403ing should still list the type that succeeded.
    if (!response || response.errors) continue
    const results: Array<any> = Array.isArray(response.results) ? response.results : []

    for (const child of results) {
      const id = child?.id != null ? String(child.id) : ''
      if (!id || seen.has(id)) continue

      let body: any = null
      try {
        const raw = child?.body?.raw?.value
        body = raw ? JSON.parse(raw) : null
      } catch {
        // Malformed stored body. The diagram still exists on the page and the
        // user can still see it there, so list it as an untyped entry rather
        // than silently dropping it — a disappearing diagram would read as
        // data loss.
        body = null
      }

      const diagramType = typeof body?.diagramType === 'string' ? body.diagramType : DiagramType.Unknown
      const copyable = COPYABLE_TYPES.includes(diagramType)
      let source = ''
      if (copyable) {
        try {
          source = getDiagramData(body) || ''
        } catch {
          source = ''
        }
      }

      seen.add(id)
      out.push({
        id,
        title: String(child?.title || '').trim() || typeLabel(diagramType),
        diagramType,
        source,
        // A copyable type with an empty body has nothing to copy — don't offer
        // a button that yields an empty clipboard.
        copyable: copyable && source.length > 0,
        createdAt: typeof child?.createdAt === 'string' ? child.createdAt : '',
      })
    }
  }

  return out
}

/**
 * Order the list the way the page reads.
 *
 * Primary key is where the diagram's macro sits on the page, so the panel is an
 * index of the page rather than of the API's return order — which is grouped by
 * custom-content type (all sequence-family entries, then all graphs) and has no
 * relationship to what the reader sees.
 *
 * Diagrams no macro references have no position, so they sort after everything
 * placed, oldest first. That is also the whole-list order when `placedOrder` is
 * absent — either the page ADF could not be read, or it has not arrived yet.
 *
 * `createdAt` is compared as a string: these are ISO-8601 UTC timestamps from
 * the v2 API (`2025-12-28T09:53:08.890Z`), a format whose lexicographic order is
 * its chronological order. Entries missing one sort last within their group —
 * unknown is not "oldest".
 */
export function sortPageDiagrams(diagrams: PageDiagram[], placedOrder?: string[]): PageDiagram[] {
  const position = new Map<string, number>()
  // First occurrence wins: one custom content can be referenced by several
  // macros (a copied macro), and the entry belongs where the reader first meets
  // it, not at its last duplicate.
  placedOrder?.forEach((id, i) => {
    if (!position.has(id)) position.set(id, i)
  })

  const byCreation = (a: PageDiagram, b: PageDiagram): number => {
    if (!a.createdAt || !b.createdAt) return (a.createdAt ? 0 : 1) - (b.createdAt ? 0 : 1)
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
  }

  return [...diagrams].sort((a, b) => {
    const pa = position.get(a.id)
    const pb = position.get(b.id)
    if (pa !== undefined && pb !== undefined) return pa - pb
    if (pa !== undefined) return -1
    if (pb !== undefined) return 1
    return byCreation(a, b)
  })
}

/** Analytics shape for `byline_opened`. `macro_types` is comma-joined and
 *  de-duplicated so it stays a low-cardinality Mixpanel property.
 *
 *  The types go through `toMacroType` first: emitting the raw stored values
 *  would put `OpenAPI` / `Sequence` / `unknown` in `macro_types` while
 *  `macro_type` on every other byline event carries the lowercase catalog
 *  vocabulary, so the two could not be joined in Mixpanel without per-query
 *  string munging — the exact friction the catalog exists to remove. */
export function summarizeDiagrams(diagrams: PageDiagram[]): {
  page_has_diagram: boolean
  diagram_count: number
  macro_types: string
} {
  const types = Array.from(new Set(diagrams.map(d => toMacroType(d.diagramType)))).sort()
  return {
    page_has_diagram: diagrams.length > 0,
    diagram_count: diagrams.length,
    macro_types: types.join(','),
  }
}

/**
 * Nothing on the listing path rejects.
 *
 * `forgeRequest` resolves with the API's error body regardless of HTTP status
 * (see the note above `assertSavedCustomContent` in ApWrapper2), and
 * `listPageDiagramContents` additionally converts a genuine throw into the same
 * `{ errors: [...] }` shape. So a 403 or a rate-limit arrives here looking
 * exactly like a page that has no diagrams, and callers that only watch for a
 * rejection see a clean, empty, wrong answer.
 *
 * That reaches past the UI: `byline_opened` IS the Phase 1 readout, so a
 * permissions blip on a subset of tenants would report `diagram_count: 0` /
 * `page_has_diagram: false` for pages that do have diagrams, biasing the
 * primary metric toward "the byline finds nothing here" with no way to tell it
 * apart from the real thing.
 */
function isErrorResponse(response: any): boolean {
  return !response || !!response.errors || !Array.isArray(response.results)
}

export interface ListingHealth {
  /** How many of the probed content types came back error-shaped. */
  failed_type_count: number
  /** True when NOTHING usable came back — the list is unknown, not empty. */
  listing_failed: boolean
}

export function summarizeListing(responses: Array<any>): ListingHealth {
  const list = Array.isArray(responses) ? responses : []
  const failed = list.filter(isErrorResponse).length
  return {
    failed_type_count: failed,
    // An empty array is `listPageDiagramContents`'s outer-catch return value,
    // which means every type failed — not that no type was probed.
    listing_failed: list.length === 0 || failed === list.length,
  }
}
