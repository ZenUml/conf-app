import { describe, expect, it, vi } from 'vitest'
import { createFeedbackSession, type FeedbackContext } from './feedbackSession'

const context: FeedbackContext = {
  surface: 'viewer',
  hostModule: 'zenuml-sequence-macro-lite',
  diagramType: 'mermaid',
  diagramTitle: 'Example diagram',
  userAccountId: 'account-example',
  clientDomain: 'example-tenant',
  spaceName: 'Example space',
  macroUuid: 'macro-example',
  contentId: 'content-example',
  customContentId: 'custom-content-example',
}

describe('feedback session privacy boundary', () => {
  it('keeps draft content local until the user explicitly submits', async () => {
    const submit = vi.fn().mockResolvedValue({ reportReference: 'FBR-EXAMPLE1234' })
    const track = vi.fn()
    const session = createFeedbackSession({ context, submit, track })

    session.open()
    session.setDescription('The diagram is difficult to read.')

    expect(submit).not.toHaveBeenCalled()
    expect(track).toHaveBeenCalledWith('feedback_report_opened', expect.not.objectContaining({
      description: expect.anything(),
      diagramSource: expect.anything(),
    }))

    await session.submit()

    expect(submit).toHaveBeenCalledOnce()
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      description: 'The diagram is difficult to read.',
      context,
      submissionId: expect.any(String),
    }))
  })

  it('automatically hands a successfully saved report to support without copying report content', async () => {
    const submit = vi.fn().mockResolvedValue({ reportReference: 'FBR-EXAMPLE1234' })
    const handoff = vi.fn().mockResolvedValue({ opened: true })
    const track = vi.fn()
    const session = createFeedbackSession({ context, submit, handoff, track })
    session.setDescription('Private report text')

    await expect(session.submit()).resolves.toBe(true)

    expect(session.submissionState).toBe('succeeded')
    expect(handoff).toHaveBeenCalledWith('FBR-EXAMPLE1234')
    expect(session.manualSupportUrl).toBe('')
    expect(handoff.mock.calls[0][0]).not.toContain('Private report text')
    expect(track).toHaveBeenCalledWith('feedback_report_handoff_requested', expect.any(Object))
    expect(track).toHaveBeenCalledWith('feedback_report_handoff_opened', expect.objectContaining({
      feedback_handoff_outcome: 'opened',
    }))
  })

  it('keeps the report saved and exposes a manual support link when automatic handoff is blocked', async () => {
    const submit = vi.fn().mockResolvedValue({ reportReference: 'FBR-EXAMPLE1234' })
    const handoff = vi.fn().mockResolvedValue({ opened: false, manualUrl: 'https://support.example/form?ref=FBR-EXAMPLE1234' })
    const track = vi.fn()
    const session = createFeedbackSession({ context, submit, handoff, track })
    session.setDescription('Saved even when navigation is blocked')

    await session.submit()

    expect(session.submissionState).toBe('succeeded')
    expect(session.reportReference).toBe('FBR-EXAMPLE1234')
    expect(session.manualSupportUrl).toBe('https://support.example/form?ref=FBR-EXAMPLE1234')
    expect(track).toHaveBeenCalledWith('feedback_report_handoff_blocked', expect.objectContaining({
      feedback_handoff_outcome: 'blocked',
    }))
  })

  it('requires a description without starting submission telemetry or transport', async () => {
    const submit = vi.fn()
    const track = vi.fn()
    const session = createFeedbackSession({ context, submit, track })

    await expect(session.submit()).resolves.toBe(false)

    expect(session.errorMessage).toBe('Describe what happened before sending.')
    expect(submit).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalled()
  })

  it('preserves the user original multiline plain text on submission', async () => {
    const submit = vi.fn().mockResolvedValue({ reportReference: 'FBR-EXAMPLE1234' })
    const session = createFeedbackSession({ context, submit, track: vi.fn() })
    const original = '  First line\n- bullet\n`literal`\n  last line  '
    session.setDescription(original)

    await session.submit()

    expect(submit.mock.calls[0][0].description).toBe(original)
  })
})
