import { describe, it } from 'vitest'

// Approved PNG Export acceptance criteria. These remain pending until the
// finalized visual design unpauses frontend implementation; keeping them here
// prevents the capture/privacy constraints from being lost during that handoff.
describe('PNG Export feedback acceptance', () => {
  it.todo('reveals the flush-right Feedback trigger only on edge hover or keyboard focus')
  it.todo('opens the shared feedback flow with surface set to png_export')
  it.todo('places the trigger, dialog, and feedback controls outside the export capture subtree')
  it.todo('produces preview and downloaded PNG bytes without any feedback overlay pixels')
})
