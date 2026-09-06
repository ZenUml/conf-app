import { describe, it, expect, beforeEach, vi } from 'vitest'
import { placeDiagram } from './placeDiagram'
import { DiagramType } from '@/model/Diagram/Diagram'

const addDiagramToPage = vi.hoisted(() => vi.fn())
const reloadHostPage = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/utils/byline/addToPage', () => ({ addDiagramToPage, reloadHostPage }))

const requestReveal = vi.hoisted(() => vi.fn())
const cancelReveal = vi.hoisted(() => vi.fn())
vi.mock('@/utils/byline/revealDiagram', () => ({ requestReveal, cancelReveal }))

const DIAGRAM = { id: 'cc-2', diagramType: DiagramType.Sequence }

describe('placeDiagram — the step both surfaces share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    addDiagramToPage.mockResolvedValue({ result: 'added', pageMacroCount: 3 })
    reloadHostPage.mockResolvedValue(true)
  })

  it('reloads the host page, because a place that shows nothing looks like nothing', async () => {
    const outcome = await placeDiagram('page-1', DIAGRAM)

    expect(addDiagramToPage).toHaveBeenCalledWith('page-1', DIAGRAM)
    expect(reloadHostPage).toHaveBeenCalled()
    expect(outcome).toMatchObject({ result: 'added', placed: true, refused: false, message: null })
    expect(outcome.pageMacroCount).toBe(3)
  })

  it('leaves the reveal note before reloading, never after', async () => {
    // After the reload there is no "after" — the iframe is gone.
    await placeDiagram('page-1', DIAGRAM)

    expect(requestReveal).toHaveBeenCalledWith('page-1', 'cc-2')
    expect(requestReveal.mock.invocationCallOrder[0]).toBeLessThan(
      reloadHostPage.mock.invocationCallOrder[0],
    )
  })

  it('withdraws the note when the reload never happened', async () => {
    // A note nobody can claim would scroll the NEXT page load instead.
    reloadHostPage.mockResolvedValue(false)
    await placeDiagram('page-1', DIAGRAM)

    expect(cancelReveal).toHaveBeenCalled()
  })

  it('runs the caller’s work BEFORE the reload', async () => {
    // The caller rewrites the record the reloaded page reads; doing it after
    // would race the load.
    const onPlaced = vi.fn()
    await placeDiagram('page-1', DIAGRAM, onPlaced)

    expect(onPlaced).toHaveBeenCalled()
    expect(onPlaced.mock.invocationCallOrder[0]).toBeLessThan(
      reloadHostPage.mock.invocationCallOrder[0],
    )
  })

  it('awaits the caller’s work, so an async rewrite lands first', async () => {
    let finished = false
    await placeDiagram('page-1', DIAGRAM, async () => {
      await Promise.resolve()
      finished = true
    })

    expect(finished).toBe(true)
  })

  it('does not reload for a diagram the page already carried', async () => {
    // Nothing was written, so there is nothing new to show — but the caller
    // still gets to retire a record that is now wrong.
    addDiagramToPage.mockResolvedValue({ result: 'already_present', pageMacroCount: 3 })
    const onPlaced = vi.fn()
    const outcome = await placeDiagram('page-1', DIAGRAM, onPlaced)

    expect(onPlaced).toHaveBeenCalled()
    expect(reloadHostPage).not.toHaveBeenCalled()
    expect(requestReveal).not.toHaveBeenCalled()
    expect(outcome.placed).toBe(true)
  })

  it('marks ONLY a refusal as refused', async () => {
    // 'failed' is a 500 or a dropped connection and says nothing about
    // permission. Treating the two alike took the button off every remaining
    // row for the life of an iframe after one blip.
    addDiagramToPage.mockResolvedValue({ result: 'forbidden' })
    expect((await placeDiagram('page-1', DIAGRAM)).refused).toBe(true)

    addDiagramToPage.mockResolvedValue({ result: 'failed' })
    const failed = await placeDiagram('page-1', DIAGRAM)
    expect(failed.refused).toBe(false)
    expect(failed.message).toContain('Try again')
  })

  it.each([
    ['forbidden', 'permission'],
    ['conflict', 'Reload and try again'],
    ['failed', 'Try again'],
  ])('says something useful about %s, and does nothing else', async (result, phrase) => {
    addDiagramToPage.mockResolvedValue({ result })
    const onPlaced = vi.fn()
    const outcome = await placeDiagram('page-1', DIAGRAM, onPlaced)

    expect(outcome.placed).toBe(false)
    expect(outcome.message).toContain(phrase)
    expect(onPlaced).not.toHaveBeenCalled()
    expect(reloadHostPage).not.toHaveBeenCalled()
    expect(requestReveal).not.toHaveBeenCalled()
  })
})
