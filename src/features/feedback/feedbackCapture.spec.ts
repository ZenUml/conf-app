import { afterEach, describe, expect, it, vi } from 'vitest'

import captureBlob from '@/model/captureBlob'
import { captureFeedbackElement, feedbackCaptureTarget } from './feedbackCapture'

vi.mock('@/model/captureBlob', () => ({ default: vi.fn() }))

describe('feedbackCaptureTarget', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.mocked(captureBlob).mockReset()
  })

  it('selects the diagram capture surface instead of its #app ancestor', () => {
    document.body.innerHTML = `
      <div id="app">
        <div class="screen-capture-content">diagram</div>
        <div id="zenuml-feedback-host">feedback controls</div>
      </div>
    `

    expect(feedbackCaptureTarget()).toBe(document.querySelector('.screen-capture-content'))
  })

  it('downscales a current-view capture until it fits the 1 MB storage limit', async () => {
    const target = document.createElement('div')
    vi.mocked(captureBlob)
      .mockResolvedValueOnce(new Blob([new Uint8Array(1024 * 1024 + 1)], { type: 'image/png' }))
      .mockResolvedValueOnce(new Blob([new Uint8Array(512)], { type: 'image/png' }))

    const captured = await captureFeedbackElement(target)

    expect(captureBlob).toHaveBeenNthCalledWith(1, target, { backgroundColor: '#ffffff', pixelRatio: 1 })
    expect(captureBlob).toHaveBeenNthCalledWith(2, target, { backgroundColor: '#ffffff', pixelRatio: 0.75 })
    expect(captured.dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('rejects a current-view capture when every downscaled result exceeds 1 MB', async () => {
    const target = document.createElement('div')
    vi.mocked(captureBlob).mockResolvedValue(new Blob([new Uint8Array(1024 * 1024 + 1)], { type: 'image/png' }))

    await expect(captureFeedbackElement(target)).rejects.toThrow('FeedbackCaptureTooLarge')
    expect(captureBlob).toHaveBeenCalledTimes(4)
  })
})
