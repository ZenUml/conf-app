import captureBlob from '@/model/captureBlob'
import type { FeedbackScreenshot } from './feedbackSession'

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('CaptureReadError'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

export function feedbackCaptureTarget(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '.screen-capture-content, .workspace, .get-started-page, .asyncapi-dashboard, #app',
  )
}

export async function captureFeedbackSurface(): Promise<FeedbackScreenshot> {
  const target = feedbackCaptureTarget()
  if (!target) throw new Error('FeedbackCaptureTargetUnavailable')
  return captureFeedbackElement(target)
}

export async function captureFeedbackElement(target: HTMLElement): Promise<FeedbackScreenshot> {
  const blob = await captureBlob(target, { backgroundColor: '#ffffff', pixelRatio: 1 })
  if (!blob) throw new Error('FeedbackCaptureFailed')
  return {
    dataUrl: await blobDataUrl(blob),
    name: 'zenuml-current-view.png',
    method: 'current_view',
  }
}
