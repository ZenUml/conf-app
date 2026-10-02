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

  it.each([DiagramType.AsyncApi, DiagramType.Embed, DiagramType.Unknown, undefined, null])('has no guide for %s', (diagramType) => {
    expect(createGuideVariant(diagramType)).toBeNull()
  })
})
