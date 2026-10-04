import { DiagramType } from '@/model/Diagram/Diagram'
import type { CreateGuideVariant } from '@/utils/analytics/catalog'

/**
 * Which slash-command guide teaches how to add another diagram like the one being viewed.
 * Sequence / Mermaid / PlantUML / Markdown all live in the "Diagram (Mermaid, PlantUML & ZenUML)"
 * macro, inserted with /zenuml. Types without a recorded guide return null (no Create button).
 */
export function createGuideVariant(diagramType: DiagramType | string | null | undefined): CreateGuideVariant | null {
  // Case-insensitive: the OpenAPI viewer stores 'openapi', while DiagramType.OpenApi is 'OpenAPI'.
  switch (String(diagramType ?? '').toLowerCase()) {
    case DiagramType.Sequence:
    case DiagramType.Mermaid:
    case DiagramType.PlantUml:
    case DiagramType.Markdown:
      return 'zenuml'
    case DiagramType.Graph:
      return 'graph'
    case DiagramType.OpenApi.toLowerCase():
      return 'api'
    default:
      return null
  }
}
