import { describe, expect, it } from 'vitest'
import { DiagramType } from '@/model/Diagram/Diagram'
import { createGuideVariant } from './createGuideVariant'

describe('createGuideVariant', () => {
  it.each([
    [DiagramType.Sequence, 'zenuml'],
    [DiagramType.Mermaid, 'zenuml'],
    [DiagramType.PlantUml, 'zenuml'],
    [DiagramType.Markdown, 'zenuml'],
    [DiagramType.Graph, 'graph'],
    [DiagramType.OpenApi, 'api'],
  ])('maps %s to the %s guide', (diagramType, variant) => {
    expect(createGuideVariant(diagramType)).toBe(variant)
  })

  // The OpenAPI viewer stores its type as lowercase 'openapi', not DiagramType.OpenApi ('OpenAPI') —
  // seen live through the Forge tunnel on lite-dev, 2026-10-02 (feedbackContext.ts normalizes it too).
  it.each([['openapi', 'api'], ['asyncapi', null]])('matches the runtime lowercase type %s', (diagramType, variant) => {
    expect(createGuideVariant(diagramType)).toBe(variant)
  })

  it.each([DiagramType.AsyncApi, DiagramType.Embed, DiagramType.Unknown, undefined, null])('has no guide for %s', (diagramType) => {
    expect(createGuideVariant(diagramType)).toBeNull()
  })
})
