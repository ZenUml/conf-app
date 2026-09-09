import { describe, expect, it } from 'vitest'
import * as stories from './Workspace.stories'

describe('full Diagram Editor stories', () => {
  it('covers every text-based diagram editor', () => {
    expect(stories.Sequence).toBeDefined()
    expect(stories.Mermaid).toBeDefined()
    expect(stories.PlantUML).toBeDefined()
  })
})
