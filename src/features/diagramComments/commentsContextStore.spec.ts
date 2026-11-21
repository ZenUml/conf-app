import { beforeEach, describe, expect, it } from 'vitest'
import { commentsContext, publishCommentsContext, readCommentsContext, resetCommentsContext } from './commentsContextStore'

describe('commentsContextStore', () => {
  beforeEach(() => resetCommentsContext())

  it('has nothing to hand over until the viewer has loaded the diagram', () => {
    expect(readCommentsContext()).toBeNull()
  })

  it('publishes fields piecemeal and reads a snapshot once the diagram id exists', () => {
    publishCommentsContext({ diagramTitle: 'Checkout' })
    expect(readCommentsContext()).toBeNull()
    publishCommentsContext({ diagramId: 'cc-1', diagramVersion: 4, lastModifierId: 'acc-9', macroType: 'mermaid' })
    expect(readCommentsContext()).toEqual({
      diagramId: 'cc-1', diagramVersion: 4, diagramTitle: 'Checkout', lastModifierId: 'acc-9', macroType: 'mermaid',
    })
  })

  it('is reactive so a button can appear when the id arrives', () => {
    expect(commentsContext.diagramId).toBeUndefined()
    publishCommentsContext({ diagramId: 'cc-2' })
    expect(commentsContext.diagramId).toBe('cc-2')
  })

  it('drops an id the viewer later loses', () => {
    publishCommentsContext({ diagramId: 'cc-1' })
    publishCommentsContext({ diagramId: undefined })
    expect(readCommentsContext()).toBeNull()
  })
})
