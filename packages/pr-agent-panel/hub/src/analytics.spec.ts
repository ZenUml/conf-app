import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALLOWED_PROPERTY_KEYS, Analytics, MIXPANEL_TRACK_URL, type FetchLike } from './analytics'
import { tempDir } from './test-helpers'

describe('Analytics', () => {
  it('is disabled and silent without a token', async () => {
    const calls: unknown[] = []
    const analytics = new Analytics({ idPath: join(tempDir(), 'id'), fetchImpl: async (...args) => calls.push(args) })
    expect(analytics.enabled).toBe(false)
    analytics.track('pr_panel_task_started', { task_kind: 'review' })
    await analytics.flush()
    expect(calls).toEqual([])
  })

  it('sends only allowlisted properties plus the fixed envelope', async () => {
    const sent: { url: string; body: string }[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      sent.push({ url, body: init.body })
      return {}
    }
    const idPath = join(tempDir(), 'analytics-id')
    const analytics = new Analytics({ token: 'tok', idPath, fetchImpl, now: () => 1_700_000_000_123 })
    analytics.track('pr_panel_task_completed', {
      task_outcome: 'completed',
      duration_ms: 1234,
      finding_count: 2,
      turn_count: 1,
      repo: 'acme/widgets',
      pr_number: 7,
      title: 'secret',
      headSha: 'abc',
      text: 'hello',
    })
    await analytics.flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe(MIXPANEL_TRACK_URL)
    const [event] = JSON.parse(sent[0].body) as { event: string; properties: Record<string, unknown> }[]
    expect(event.event).toBe('pr_panel_task_completed')
    const envelope = new Set(['token', 'distinct_id', 'time', 'feature_area', 'surface'])
    for (const key of Object.keys(event.properties)) {
      expect(ALLOWED_PROPERTY_KEYS.has(key) || envelope.has(key)).toBe(true)
    }
    expect(event.properties).toMatchObject({
      token: 'tok',
      feature_area: 'pr_agent_panel',
      surface: 'github_pr',
      time: 1_700_000_000,
      task_outcome: 'completed',
      duration_ms: 1234,
    })
    expect(event.properties.distinct_id).toBe(readFileSync(idPath, 'utf8'))
    expect(statSync(idPath).mode & 0o777).toBe(0o600)
  })

  it('never throws when the network fails', async () => {
    const analytics = new Analytics({
      token: 'tok',
      idPath: join(tempDir(), 'id'),
      fetchImpl: () => Promise.reject(new Error('offline')),
    })
    expect(() => analytics.track('pr_panel_message_queued')).not.toThrow()
    await expect(analytics.flush()).resolves.toBeUndefined()
  })
})
