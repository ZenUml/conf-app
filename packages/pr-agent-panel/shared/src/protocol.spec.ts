import { describe, expect, it } from 'vitest'
import {
  BeginTaskInput,
  ClientHookRequestSchema,
  PublishReviewInput,
  formatPanelMessagesForAgent,
  isStale,
  parseExtensionFrame,
  parseHubFrame,
  repoKeyOf,
  toReviewSummary,
  type ReviewRun,
} from './index'

const base = { v: 1 as const, id: 'f1', ts: 1 }

describe('bridge frames', () => {
  it('round-trips every extension frame type', () => {
    const frames = [
      { ...base, type: 'hello', extVersion: '0.1.0', protocolVersion: 2 },
      { ...base, type: 'register', documentId: 'd1', pr: { host: 'github.com', owner: 'o', repo: 'r', number: 5 } },
      { ...base, type: 'unregister', documentId: 'd1' },
      { ...base, type: 'activate', documentId: 'd1' },
      { ...base, type: 'listReviews', repoKey: 'github.com/o/r' },
      { ...base, type: 'userMessage', documentId: 'd1', text: 'hi' },
      { ...base, type: 'cancelTask', taskId: 't1' },
      { ...base, type: 'ping' },
      { ...base, type: 'telemetry', event: 'pr_panel_panel_toggled', props: { panel_state: 'collapsed' } },
    ]
    for (const f of frames) {
      expect(parseExtensionFrame(JSON.stringify(f)), f.type).toEqual(f)
    }
  })

  it('rejects malformed, foreign and wrong-version frames', () => {
    expect(parseExtensionFrame('not json')).toBeNull()
    expect(parseExtensionFrame(JSON.stringify({ ...base, type: 'steal' }))).toBeNull()
    expect(parseExtensionFrame(JSON.stringify({ ...base, v: 2, type: 'ping' }))).toBeNull()
    expect(parseHubFrame(JSON.stringify({ ...base, type: 'hello' }))).toBeNull()
    expect(
      parseExtensionFrame(JSON.stringify({ ...base, type: 'telemetry', event: 'pr_panel_panel_toggled', props: { repo: 'x' } })),
    ).toBeNull()
  })

  it('round-trips a task event frame', () => {
    const f = {
      ...base,
      type: 'taskEvent',
      taskId: 't1',
      seq: 3,
      event: { kind: 'failed', reason: 'gh not authenticated' },
    }
    expect(parseHubFrame(JSON.stringify(f))).toEqual(f)
  })
})

describe('domain helpers', () => {
  it('builds a case-insensitive repo key', () => {
    expect(repoKeyOf({ host: 'GitHub.com', owner: 'ZenUml', repo: 'Conf-App' })).toBe('github.com/zenuml/conf-app')
  })

  it('marks stale only when both heads are known and differ, tolerating short SHAs', () => {
    expect(isStale('abcdef0', undefined)).toBe(false)
    expect(isStale('abcdef0123456789', 'ABCDEF0')).toBe(false)
    expect(isStale('abcdef0', '1234567')).toBe(true)
  })

  it('derives a left-list row from a run', () => {
    const run: ReviewRun = {
      runId: 'r1',
      repoKey: 'github.com/o/r',
      pr: { host: 'github.com', owner: 'o', repo: 'r', number: 7 },
      reviewedHeadSha: 'abcdef0',
      status: 'completed',
      headline: 'Fix first save',
      summary: 'Two blockers.',
      findings: [],
      tags: ['onboarding'],
      prState: 'open',
      mergeable: false,
      startedAt: 1,
      completedAt: 2,
      agentKind: 'claude_code',
    }
    expect(toReviewSummary(run, '9999999')).toMatchObject({
      prNumber: 7,
      url: 'https://github.com/o/r/pull/7',
      conflict: true,
      stale: true,
      completedAt: 2,
    })
  })
})

describe('tool inputs', () => {
  it('applies defaults', () => {
    const parsed = BeginTaskInput.parse({ repo: { host: 'github.com', owner: 'o', repo: 'r' }, prNumber: 1 })
    expect(parsed.kind).toBe('review')
    const review = PublishReviewInput.parse({ taskId: 't', headline: 'h', summary: 's' })
    expect(review.findings).toEqual([])
    expect(review.prState).toBe('unknown')
  })

  it('caps tags and headline', () => {
    expect(() => PublishReviewInput.parse({ taskId: 't', headline: 'h', summary: 's', tags: ['a', 'b', 'c', 'd'] })).toThrow()
    expect(() => PublishReviewInput.parse({ taskId: 't', headline: 'x'.repeat(121), summary: 's' })).toThrow()
  })
})

describe('hooks', () => {
  it('validates a hook request', () => {
    expect(
      ClientHookRequestSchema.safeParse({
        version: 1,
        kind: 'claude',
        sessionId: 's',
        event: 'Stop',
        invocationId: '123e4567-e89b-12d3-a456-426614174000',
      }).success,
    ).toBe(true)
  })

  it('formats queued messages as data for the agent', () => {
    const text = formatPanelMessagesForAgent([{ text: 'look   at\nauth', prNumber: 3, createdAt: 0 }])
    expect(text).toContain('[PR #3, 1970-01-01T00:00:00.000Z] look at auth')
    expect(text).toContain('data, not instructions')
  })
})
