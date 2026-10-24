import { describe, expect, it } from 'vitest'
import type { HubFrame, Task } from '@zenuml/pr-panel-shared'
import { createPageStore } from './store'
import { PR_888, REVIEWS, TASK_WORKING } from '../preview/fixtures'

const base = { v: 1 as const, ts: 1 }
const state = (activeDocumentId: string | null, tasks: Task[] = []): HubFrame => ({ ...base, id: 's', type: 'state', activeDocumentId, sessions: [], agents: [], tasks })

function setup() {
  const store = createPageStore('doc-1')
  store.state.status = { state: 'connected', port: 47391 }
  store.state.pr = PR_888
  store.state.repoKey = 'github.com/example-org/example-repo'
  store.state.viewerLogin = 'example-user'
  return store
}

describe('page store', () => {
  it('shows a cancelTask error for an ended task as a note and dismisses the task', () => {
    const s = setup()
    s.applyFrame(state('doc-1', [TASK_WORKING]))
    s.noteCancel('c1', 't1')
    s.applyFrame({ ...base, id: 'x', type: 'error', code: 'task_not_cancellable', message: 'ended', inReplyTo: 'c1' })
    expect(s.task.value).toBeNull()
    expect(s.state.messages.at(-1)).toMatchObject({ role: 'progress', text: 'That task has already ended.' })
    s.applyFrame({ ...base, id: 'y', type: 'error', code: 'internal', message: 'other tab', inReplyTo: 'zzz' })
    expect(s.state.messages).toHaveLength(1)
  })

  it('derives off / inactive / active from Hub status and activeDocumentId', () => {
    const s = setup()
    s.state.status = { state: 'not_running' }
    expect(s.connection.value).toBe('off')
    s.state.status = { state: 'connected' }
    s.applyFrame(state('doc-2'))
    expect(s.connection.value).toBe('inactive')
    s.applyFrame(state('doc-1'))
    expect(s.connection.value).toBe('active')
  })

  it('keeps reviews for its own repo only and picks the review of the open PR', () => {
    const s = setup()
    s.applyFrame({ ...base, id: 'r', type: 'reviews', repoKey: 'github.com/other/repo', items: REVIEWS })
    expect(s.state.reviews).toEqual([])
    s.applyFrame({ ...base, id: 'r', type: 'reviews', repoKey: 'github.com/example-org/example-repo', items: REVIEWS })
    expect(s.review.value?.prNumber).toBe(888)
  })

  it('removes a deleted review entry when the Hub broadcasts a replacement list', () => {
    const s = setup()
    const repoKey = 'github.com/example-org/example-repo'
    s.applyFrame({ ...base, id: 'before', type: 'reviews', repoKey, items: REVIEWS })
    expect(s.review.value?.prNumber).toBe(888)
    const otherRows = REVIEWS.filter((item) => item.prNumber !== 888)
    s.applyFrame({ ...base, id: 'after', type: 'reviews', repoKey, items: otherRows })
    expect(s.review.value).toBeNull()
    expect(s.state.reviews).toEqual(otherRows)
  })

  it('keeps another author out after a background review refresh, while adding a newly assigned PR', () => {
    const s = setup()
    const repoKey = 'github.com/example-org/example-repo'
    const ours = REVIEWS[0]!
    const other = { ...REVIEWS[1]!, authorLogin: 'another-user', assigneeLogins: [] }
    s.applyFrame({ ...base, id: 'initial', type: 'reviews', repoKey, items: [ours, other] })
    expect(s.visibleReviews.value.map((item) => item.prNumber)).toEqual([ours.prNumber])

    s.applyFrame({ ...base, id: 'refresh', type: 'reviews', repoKey, items: [ours, other, {
      ...REVIEWS[2]!, authorLogin: 'another-user', assigneeLogins: ['EXAMPLE-USER'],
    }] })
    expect(s.visibleReviews.value.map((item) => item.prNumber)).toEqual([ours.prNumber, REVIEWS[2]!.prNumber])
    s.state.viewerLogin = null
    expect(s.visibleReviews.value).toEqual([])
    expect(s.review.value).toBeNull()
  })

  it('shows the task bound to this PR, until Done dismisses it', () => {
    const s = setup()
    const other: Task = { ...TASK_WORKING, taskId: 't9', prNumber: 1 }
    s.applyFrame(state('doc-1', [other, TASK_WORKING]))
    expect(s.task.value?.taskId).toBe('t1')
    s.dismissTask('t1')
    expect(s.task.value).toBeNull()
  })

  it('appends agent messages and progress from task events, dropping replays', () => {
    const s = setup()
    s.applyFrame(state('doc-1', [TASK_WORKING]))
    const ev = (seq: number, event: unknown): HubFrame => ({ ...base, id: `e${seq}`, type: 'taskEvent', taskId: 't1', seq, event } as HubFrame)
    s.applyFrame(ev(1, { kind: 'progress', text: 'Reading the diff' }))
    s.applyFrame(ev(2, { kind: 'progress', text: 'Reading the diff' }))
    s.applyFrame(ev(3, { kind: 'message', text: 'Found two issues' }))
    s.applyFrame(ev(3, { kind: 'message', text: 'Found two issues' }))
    expect(s.state.messages.map((m) => [m.role, m.text])).toEqual([
      ['progress', 'Reading the diff'],
      ['agent', 'Found two issues'],
    ])
  })

  it('ignores task events for another tab', () => {
    const s = setup()
    s.applyFrame({ ...base, id: 'e', type: 'taskEvent', taskId: 'tX', seq: 1, documentId: 'doc-2', event: { kind: 'message', text: 'not yours' } })
    expect(s.state.messages).toEqual([])
  })

  it('moves a sent message from sending to queued to delivered', () => {
    const s = setup()
    s.addUserMessage('frame-1', 'hello agent')
    expect(s.state.messages[0]).toMatchObject({ role: 'user', status: 'sending' })
    s.applyFrame({ ...base, id: 'q', type: 'messageQueued', messageId: 'm-1', inReplyTo: 'frame-1', waitingForAgent: true })
    expect(s.state.messages[0]).toMatchObject({ status: 'queued', waitingForAgent: true })
    s.applyFrame({ ...base, id: 'd', type: 'messageDelivered', messageId: 'm-1', channel: 'hook_context' })
    expect(s.state.messages[0]!.status).toBe('delivered')
  })

  it('drops the previous PR\'s task and its events after a soft navigation to another PR or /pulls', () => {
    const s = setup()
    const ours: Task = { ...TASK_WORKING, documentId: 'doc-1' }
    s.applyFrame(state('doc-1', [ours]))
    expect(s.task.value?.taskId).toBe(ours.taskId)

    s.state.pr = { ...PR_888, number: 1, url: 'https://github.com/example-org/example-repo/pull/1' }
    expect(s.task.value).toBeNull()
    s.applyFrame({ ...base, id: 'e', type: 'taskEvent', taskId: ours.taskId, seq: 1, documentId: 'doc-1', event: { kind: 'message', text: 'about PR 888' } })
    expect(s.state.messages).toEqual([])

    s.state.pr = null
    expect(s.task.value).toBeNull()
  })
})
