import { describe, expect, it } from 'vitest'
import { TelemetryFrame } from '@zenuml/pr-panel-shared'
import { buildTelemetryFrame, messageLengthBucket } from './telemetry'

describe('messageLengthBucket', () => {
  it('uses short < 80, medium < 400, long otherwise', () => {
    expect(messageLengthBucket(0)).toBe('short')
    expect(messageLengthBucket(79)).toBe('short')
    expect(messageLengthBucket(80)).toBe('medium')
    expect(messageLengthBucket(399)).toBe('medium')
    expect(messageLengthBucket(400)).toBe('long')
    expect(messageLengthBucket(4000)).toBe('long')
  })
})

describe('buildTelemetryFrame', () => {
  it('builds a frame the shared schema accepts', () => {
    const frame = buildTelemetryFrame('pr_panel_review_row_clicked', { row_index: 2, is_stale: true })
    expect(TelemetryFrame.safeParse(frame).success).toBe(true)
    expect(frame).toMatchObject({ v: 1, type: 'telemetry', event: 'pr_panel_review_row_clicked', props: { row_index: 2, is_stale: true } })
    expect(frame.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('defaults props to {}', () => {
    expect(buildTelemetryFrame('pr_panel_hub_connected').props).toEqual({})
  })

  it('rejects an unknown property, so nothing outside the allowlist can leak', () => {
    expect(() =>
      buildTelemetryFrame('pr_panel_message_sent', { message_length_bucket: 'short', text: 'secret' } as never),
    ).toThrow()
    expect(() => buildTelemetryFrame('pr_panel_review_list_shown', { repo: 'ZenUml/conf-app' } as never)).toThrow()
  })

  it('rejects an unknown event and out-of-range values', () => {
    expect(() => buildTelemetryFrame('pr_panel_title_seen' as never)).toThrow()
    expect(() => buildTelemetryFrame('pr_panel_review_list_shown', { review_count: -1 })).toThrow()
  })
})
