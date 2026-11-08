import { TelemetryFrame } from '@zenuml/pr-panel-shared'
import type { z } from 'zod'

export type TelemetryFrameT = z.infer<typeof TelemetryFrame>
export type TelemetryEvent = TelemetryFrameT['event']
export type TelemetryProps = NonNullable<z.input<typeof TelemetryFrame>['props']>
export type MessageLengthBucket = NonNullable<TelemetryProps['message_length_bucket']>

/** short < 80 chars, medium < 400, long otherwise. Only the bucket leaves the page, never the text. */
export function messageLengthBucket(length: number): MessageLengthBucket {
  if (length < 80) return 'short'
  if (length < 400) return 'medium'
  return 'long'
}

export function newFrameId(): string {
  return crypto.randomUUID()
}

/**
 * Builds a telemetry frame through the shared schema. The schema is strict:
 * an unknown event or property throws, so nothing outside the allowlist can
 * be sent.
 */
export function buildTelemetryFrame(event: TelemetryEvent, props: TelemetryProps = {}): TelemetryFrameT {
  return TelemetryFrame.parse({ v: 1, id: newFrameId(), ts: Date.now(), type: 'telemetry', event, props })
}
