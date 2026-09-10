import { describe, expect, it, vi } from 'vitest'

import { buildFeedbackSupportUrl, createFeedbackTransport } from './feedbackTransport'

describe('feedback transport', () => {
  it('submits in product before opening support and gives support only the internal reference', async () => {
    const callRemote = vi.fn().mockResolvedValue({
      ok: true,
      reportReference: 'FBR-EXAMPLE1234',
      artifacts: { screenshot: 'not_retained' },
    })
    const open = vi.fn().mockResolvedValue(undefined)
    const transport = createFeedbackTransport({ callRemote, open })

    const saved = await transport.submit({
      submissionId: '1dc9c2a9-e064-4fa1-bfe5-a58f1af9cf13',
      description: 'Private report description',
      context: {} as any,
    })
    const handoff = await transport.handoff(saved.reportReference)

    expect(callRemote).toHaveBeenCalledWith('/api/feedback-report', 'POST', expect.objectContaining({
      description: 'Private report description',
    }))
    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0][0]).toContain('FBR-EXAMPLE1234')
    expect(open.mock.calls[0][0]).not.toContain('Private report description')
    expect(handoff).toEqual({ opened: true, manualUrl: open.mock.calls[0][0] })
  })

  it('returns a manual support link when navigation is blocked', async () => {
    const open = vi.fn().mockRejectedValue(new Error('popup blocked'))
    const transport = createFeedbackTransport({ callRemote: vi.fn(), open })

    await expect(transport.handoff('FBR-EXAMPLE1234')).resolves.toEqual({
      opened: false,
      manualUrl: buildFeedbackSupportUrl('FBR-EXAMPLE1234'),
    })
  })
})
