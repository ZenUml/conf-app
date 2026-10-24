import captureBlob from '@/model/captureBlob'
import type { FeedbackScreenshot } from './feedbackSession'

export const MAX_FEEDBACK_SCREENSHOT_BYTES = 1024 * 1024
const CAPTURE_PIXEL_RATIOS = [1, 0.75, 0.5, 0.35] as const

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('CaptureReadError'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

export function feedbackCaptureTarget(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.screen-capture-content')
    ?? document.querySelector<HTMLElement>('.workspace')
    ?? document.querySelector<HTMLElement>('.get-started-page')
    ?? document.querySelector<HTMLElement>('.asyncapi-dashboard')
    ?? document.querySelector<HTMLElement>('#app')
}

export async function captureFeedbackSurface(): Promise<FeedbackScreenshot> {
  const target = feedbackCaptureTarget()
  if (!target) throw new Error('FeedbackCaptureTargetUnavailable')
  return captureFeedbackElement(target)
}

export async function captureFeedbackElement(target: HTMLElement): Promise<FeedbackScreenshot> {
  for (const pixelRatio of CAPTURE_PIXEL_RATIOS) {
    const blob = await captureBlob(target, { backgroundColor: '#ffffff', pixelRatio })
    if (!blob) throw new Error('FeedbackCaptureFailed')
    if (blob.size <= MAX_FEEDBACK_SCREENSHOT_BYTES) {
      return {
        dataUrl: await blobDataUrl(blob),
        name: 'zenuml-current-view.png',
        method: 'current_view',
      }
    }
  }
  throw new Error('FeedbackCaptureTooLarge')
}
