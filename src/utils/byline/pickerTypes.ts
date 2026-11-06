import type { MacroTypeValue } from '@/utils/analytics/catalog'

/**
 * Which picker tiles the byline panel offers in each variant.
 *
 * A tile must only appear where the variant ships the macro it creates. A
 * missing macro does not produce a dead tile — it produces the WRONG editor:
 * forgeIndex reads `modal.diagramType === 'asyncapi'` but falls through to the
 * OpenAPI branch when its product gate fails, so an AsyncAPI pick in Full would
 * save a swagger document under the wrong type.
 *
 *   lite      → every type (ADR-0005 Option A ships the AsyncAPI macro)
 *   full      → no AsyncAPI (Full strips zenuml-asyncapi-macro)
 *   asyncapi  → OpenAPI + AsyncAPI only (the variant keeps just those macros)
 *
 * Diagramly ships no byline; it falls to the Full list, which matches the
 * macros it keeps. `tests/unit/forgeWizard.spec.ts` pins each list against the
 * variant's manifest edits.
 */
const ALL: readonly MacroTypeValue[] = ['mermaid', 'sequence', 'graph', 'openapi', 'asyncapi']

export function bylineTileMacroTypes(productType: string | undefined): readonly MacroTypeValue[] {
  switch (productType) {
    case 'lite':
      return ALL
    case 'asyncapi':
      return ['openapi', 'asyncapi']
    default:
      return ALL.filter(t => t !== 'asyncapi')
  }
}
