import type { MacroTypeValue } from '@/utils/analytics/catalog'

/**
 * Which picker tiles the byline panel offers in each variant.
 *
 * A tile must only appear where the variant ships the macro it creates. A
 * missing macro does not produce a dead tile — it produces the WRONG editor:
 * forgeIndex reads `modal.diagramType === 'asyncapi'` but falls through to the
 * OpenAPI branch when its product gate fails, so an AsyncAPI pick in a variant
 * without the macro would save a swagger document under the wrong type.
 *
 *   lite      → every type (ADR-0005 Option A ships the AsyncAPI macro)
 *   full      → every type (ADR-0005 "To lift" Half 1)
 *   asyncapi  → OpenAPI + AsyncAPI only (the variant keeps just those macros)
 *
 * Diagramly ships no byline; it falls to the default list, which matches the
 * macros it keeps (no AsyncAPI). `tests/unit/forgeWizard.spec.ts` pins each list against the
 * variant's manifest edits.
 */
const ALL: readonly MacroTypeValue[] = ['mermaid', 'sequence', 'graph', 'openapi', 'asyncapi']

export function bylineTileMacroTypes(productType: string | undefined): readonly MacroTypeValue[] {
  switch (productType) {
    case 'lite':
    case 'full':
      return ALL
    case 'asyncapi':
      return ['openapi', 'asyncapi']
    default:
      return ALL.filter(t => t !== 'asyncapi')
  }
}
