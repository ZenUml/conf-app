import type { FeedbackScreenshot } from './feedbackSession'

type RequestMessage = { kind: 'capture-request', requestId: string }
type ResponseMessage = { kind: 'capture-response', requestId: string, screenshot?: FeedbackScreenshot, error?: string }

export function serveFeedbackCapture(token: string, capture: () => Promise<FeedbackScreenshot>): () => void {
  const channel = new BroadcastChannel(`zenuml-feedback-${token}`)
  channel.onmessage = async ({ data }: MessageEvent<RequestMessage>) => {
    if (data?.kind !== 'capture-request') return
    try {
      channel.postMessage({ kind: 'capture-response', requestId: data.requestId, screenshot: await capture() } satisfies ResponseMessage)
    } catch (error) {
      channel.postMessage({
        kind: 'capture-response',
        requestId: data.requestId,
        error: error instanceof Error ? error.name : 'CaptureError',
      } satisfies ResponseMessage)
    }
  }
  return () => channel.close()
}

export function requestFeedbackCapture(token: string, timeoutMs = 5000): Promise<FeedbackScreenshot> {
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(`zenuml-feedback-${token}`)
    const requestId = crypto.randomUUID()
    const timeout = window.setTimeout(() => {
      channel.close()
      reject(new Error('FeedbackCaptureUnavailable'))
    }, timeoutMs)
    channel.onmessage = ({ data }: MessageEvent<ResponseMessage>) => {
      if (data?.kind !== 'capture-response' || data.requestId !== requestId) return
      window.clearTimeout(timeout)
      channel.close()
      if (data.screenshot) resolve(data.screenshot)
      else reject(new Error(data.error || 'FeedbackCaptureFailed'))
    }
    channel.postMessage({ kind: 'capture-request', requestId } satisfies RequestMessage)
  })
}
