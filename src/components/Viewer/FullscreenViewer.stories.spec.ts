import { describe, expect, it } from 'vitest'
import * as stories from './FullscreenViewer.stories'

describe('complete Fullscreen viewer stories', () => {
  it('covers the Sequence Fullscreen viewer', () => {
    expect(stories.Sequence).toBeDefined()
  })

  it('covers the Mermaid Fullscreen viewer', () => {
    expect(stories.Mermaid).toBeDefined()
  })

  it('covers the PlantUML Fullscreen viewer', () => {
    expect(stories.PlantUML).toBeDefined()
  })
})
