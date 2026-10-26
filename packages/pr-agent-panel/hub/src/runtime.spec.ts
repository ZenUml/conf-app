import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ClientHookRequest } from '@zenuml/pr-panel-shared'
import { ToolError } from './runtime'
import { PrStatusStore } from './pr-status-store'
import { PR, PR2, REPO, REPO_KEY, connectExtension, fakeConnection, frame, makeRuntime, tempDir } from './test-helpers'

function hook(event: ClientHookRequest['event'], extra: Partial<ClientHookRequest> = {}): ClientHookRequest {
  return { version: 1, kind: 'claude', sessionId: 's1', event, invocationId: randomUUID(), ...extra }
}

describe('HubRuntime: page sessions', () => {
  it('answers hello with registered + state, refuses frames before hello and protocol mismatch', () => {
    const { runtime } = makeRuntime()
    const raw = fakeConnection('raw')
    runtime.attachExtension(raw)
    runtime.handleExtensionFrame(raw.id, frame('ping', {}))
    expect(raw.last('error')?.code).toBe('bad_frame')

    const bad = fakeConnection('bad')
    runtime.attachExtension(bad)
    const result = runtime.handleExtensionFrame(bad.id, frame('hello', { extVersion: '1', protocolVersion: 2 }))
    expect(result.close).toBe(true)
    expect(bad.last('error')?.code).toBe('protocol_mismatch')

    const conn = connectExtension(runtime)
    expect(conn.frames.map((f) => f.type)).toEqual(['registered', 'state', 'group'])
  })

  it('register makes the first tab active, activate switches, unregister clears; every change pushes state', () => {
    const { runtime } = makeRuntime()
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd1', pr: PR }))
    expect(conn.last('state')?.activeDocumentId).toBe('d1')
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd2', pr: PR2 }))
    expect(conn.last('state')?.activeDocumentId).toBe('d1')
    expect(conn.last('state')?.sessions).toHaveLength(2)

    runtime.handleExtensionFrame(conn.id, frame('activate', { documentId: 'd2' }))
    expect(conn.last('state')?.activeDocumentId).toBe('d2')
    expect(runtime.getActivePr().pr?.number).toBe(8)
    expect(runtime.getActivePr().otherPrs.map((p) => p.number)).toEqual([7])

    runtime.handleExtensionFrame(conn.id, frame('activate', { documentId: 'nope' }))
    expect(conn.last('error')?.code).toBe('unknown_document')

    runtime.handleExtensionFrame(conn.id, frame('unregister', { documentId: 'd2' }))
    expect(conn.last('state')?.activeDocumentId).toBeNull()
    expect(conn.last('state')?.sessions.map((s) => s.documentId)).toEqual(['d1'])
  })

  it('a closed connection drops its tabs and the other connection hears about it', () => {
    const { runtime } = makeRuntime()
    const a = connectExtension(runtime, 'a')
    const b = connectExtension(runtime, 'b')
    runtime.handleExtensionFrame(a.id, frame('register', { documentId: 'd1', pr: PR }))
    expect(b.last('state')?.sessions).toHaveLength(1)
    runtime.detachExtension(a.id)
    expect(b.last('state')?.sessions).toHaveLength(0)
    expect(b.last('state')?.activeDocumentId).toBeNull()
  })

  it('answers ping with pong', () => {
    const { runtime } = makeRuntime()
    const conn = connectExtension(runtime)
    const ping = frame('ping', {})
    runtime.handleExtensionFrame(conn.id, ping)
    expect(conn.last('pong')?.inReplyTo).toBe(ping.id)
  })
})

describe('HubRuntime: tasks and reviews', () => {
  it('begin_task binds the tab, emits started seq 0, and publish_review stores the run and pushes reviews', () => {
    const { runtime } = makeRuntime()
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd1', pr: PR }))
    const agent = runtime.connectAgent({ kind: 'claude_code', connectedAt: 1 })

    const begun = runtime.beginTask(agent, { repo: REPO, prNumber: 7, kind: 'review', label: 'Reading' })
    expect(begun.documentId).toBe('d1')
    const started = conn.last('taskEvent')
    expect(started?.seq).toBe(0)
    expect(started?.event.kind).toBe('started')
    expect(conn.last('state')?.tasks[0].status).toBe('working')
    expect(conn.last('state')?.tasks[0].headSha).toBe('aaaaaaa1')

    runtime.reportProgress(begun.taskId, 'Reading the diff')
    expect(conn.last('taskEvent')?.seq).toBe(1)
    expect(conn.last('state')?.tasks[0].label).toBe('Reading the diff')

    const { runId } = runtime.publishReview({
      taskId: begun.taskId,
      headline: 'Needs work',
      summary: 'Two issues.',
      priority: 'P2',
      findings: [{ severity: 'major', filePath: 'a.ts', line: 3, explanation: 'Bug' }],
      tags: ['bug'],
      prState: 'open',
      mergeable: true,
    })
    const reviews = conn.last('reviews')
    expect(reviews?.repoKey).toBe(REPO_KEY)
    expect(reviews?.items.map((i) => i.runId)).toEqual([runId])
    expect(reviews?.items[0].stale).toBe(false)
    const stored = runtime.store.history(REPO_KEY, 7)
    expect(stored).toHaveLength(1)
    expect(stored[0].reviewedHeadSha).toBe('aaaaaaa1')
    expect(stored[0].findings[0].id).toBe('f1')
    expect(stored[0].pr.title).toBe('Add widget')
    expect(conn.of('taskEvent').some((f) => f.event.kind === 'published')).toBe(true)

    const done = runtime.completeTask({ taskId: begun.taskId, outcome: 'completed' })
    expect(done.task.status).toBe('finished')
    expect(done.task.runId).toBe(runId)
    expect(conn.last('taskEvent')?.event.kind).toBe('completed')
    expect(() => runtime.reportProgress(begun.taskId, 'x')).toThrow(ToolError)
  })

  it('carries the author the agent publishes, so a review is visible before any GitHub status sync', () => {
    const { runtime } = makeRuntime()
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd1', pr: PR }))
    const agent = runtime.connectAgent({ kind: 'claude_code', connectedAt: 1 })
    const begun = runtime.beginTask(agent, { repo: REPO, prNumber: 7, kind: 'review' })
    runtime.publishReview({ taskId: begun.taskId, headline: 'h', summary: 's', findings: [], tags: [], prState: 'open', authorLogin: 'example-user' })
    expect(conn.last('reviews')?.items[0].authorLogin).toBe('example-user')
    expect(runtime.store.history(REPO_KEY, 7)[0].authorLogin).toBe('example-user')
  })

  it('falls back to 0000000 when no head is known and marks the row stale once the tab head moves', () => {
    const { runtime } = makeRuntime()
    const agent = runtime.connectAgent({ kind: 'codex', connectedAt: 1 })
    const { taskId } = runtime.beginTask(agent, { repo: REPO, prNumber: 9, kind: 'review' })
    runtime.publishReview({ taskId, headline: 'h', summary: 's', findings: [], tags: [], prState: 'unknown' })
    expect(runtime.store.history(REPO_KEY, 9)[0].reviewedHeadSha).toBe('0000000')

    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd9', pr: { ...REPO, number: 9, headSha: 'deadbee1' } }))
    const ask = frame('listReviews', { repoKey: REPO_KEY })
    runtime.handleExtensionFrame(conn.id, ask)
    const reply = conn.last('reviews')
    expect(reply?.inReplyTo).toBe(ask.id)
    expect(reply?.items[0].stale).toBe(true)
  })

  it('listReviews attaches currentHeadSha to the single tab of that repository', () => {
    const { runtime } = makeRuntime()
    const agent = runtime.connectAgent({ kind: 'codex', connectedAt: 1 })
    const { taskId } = runtime.beginTask(agent, { repo: REPO, prNumber: 7, headSha: 'aaaaaaa1', kind: 'review' })
    runtime.publishReview({ taskId, headline: 'h', summary: 's', findings: [], tags: [], prState: 'open' })
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd1', pr: { ...PR, headSha: undefined } }))
    runtime.handleExtensionFrame(conn.id, frame('listReviews', { repoKey: REPO_KEY, currentHeadSha: 'ffffff0' }))
    expect(conn.last('reviews')?.items[0].stale).toBe(true)
    runtime.handleExtensionFrame(conn.id, frame('listReviews', { repoKey: REPO_KEY, currentHeadSha: 'aaaaaaa1' }))
    expect(conn.last('reviews')?.items[0].stale).toBe(false)
  })

  it('uses the current PR state and never sends ready for a draft even if cached readiness disagrees', () => {
    const statuses = new PrStatusStore(tempDir())
    const { runtime } = makeRuntime({ statuses })
    const agent = runtime.connectAgent({ kind: 'codex', connectedAt: 1 })
    const { taskId } = runtime.beginTask(agent, { repo: REPO, prNumber: 7, headSha: 'aaaaaaa1', kind: 'review' })
    runtime.publishReview({ taskId, headline: 'h', summary: 's', findings: [], tags: [], prState: 'draft' })
    const conn = connectExtension(runtime)

    statuses.set(REPO_KEY, 7, { state: 'draft', headSha: 'aaaaaaa1', readiness: 'ready' })
    runtime.handleExtensionFrame(conn.id, frame('listReviews', { repoKey: REPO_KEY }))
    expect(conn.last('reviews')?.items[0]).toMatchObject({ prState: 'draft', readiness: 'blocked', readinessReason: 'Draft PR' })

    statuses.set(REPO_KEY, 7, { state: 'open', headSha: 'bbbbbbb2', readiness: 'ready' })
    runtime.handleExtensionFrame(conn.id, frame('listReviews', { repoKey: REPO_KEY }))
    expect(conn.last('reviews')?.items[0]).toMatchObject({ prState: 'open', readiness: 'ready', stale: true })
  })

  it('cancelTask cancels a working task once and refuses the second time', () => {
    const { runtime } = makeRuntime()
    const conn = connectExtension(runtime)
    const agent = runtime.connectAgent({ kind: 'claude_code', connectedAt: 1 })
    const { taskId } = runtime.beginTask(agent, { repo: REPO, prNumber: 7, kind: 'review' })
    runtime.handleExtensionFrame(conn.id, frame('cancelTask', { taskId }))
    expect(conn.last('taskEvent')?.event.kind).toBe('cancelled')
    expect(runtime.getTask(taskId)?.status).toBe('cancelled')
    runtime.handleExtensionFrame(conn.id, frame('cancelTask', { taskId }))
    expect(conn.last('error')?.code).toBe('task_not_cancellable')
    runtime.handleExtensionFrame(conn.id, frame('cancelTask', { taskId: 'nope' }))
    expect(conn.last('error')?.code).toBe('unknown_task')
    // The agent's later complete_task does not overwrite the user's Stop.
    expect(runtime.completeTask({ taskId, outcome: 'completed' }).task.status).toBe('cancelled')
    expect(() => runtime.publishReview({ taskId, headline: 'h', summary: 's', findings: [], tags: [], prState: 'open' })).toThrow(/cancelled/)
  })
})

describe('HubRuntime: message queue', () => {
  it('queues a message, says waitingForAgent when no agent is in a turn, and binds it to the working task', () => {
    const { runtime } = makeRuntime()
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd1', pr: PR }))
    const send = frame('userMessage', { documentId: 'd1', text: 'Please look at a.ts' })
    runtime.handleExtensionFrame(conn.id, send)
    const queued = conn.last('messageQueued')
    expect(queued?.inReplyTo).toBe(send.id)
    expect(queued?.waitingForAgent).toBe(true)

    const agent = runtime.connectAgent({ kind: 'claude_code', connectedAt: 1 })
    const begun = runtime.beginTask(agent, { repo: REPO, prNumber: 7, kind: 'review' })
    expect(begun.pendingMessages.map((m) => m.text)).toEqual(['Please look at a.ts'])
    expect(conn.last('messageDelivered')?.channel).toBe('tool_poll')

    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', text: 'Also b.ts' }))
    const pending = runtime.queue.pending()
    expect(pending).toHaveLength(1)
    expect(pending[0].taskId).toBe(begun.taskId)

    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'zz', text: 'x' }))
    expect(conn.last('error')?.code).toBe('unknown_document')
  })

  it('a waiting wait_for_panel_messages call takes the message at once, after messageQueued', async () => {
    const { runtime } = makeRuntime()
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd1', pr: PR }))
    const agent = runtime.connectAgent({ kind: 'claude_code', connectedAt: 1 })
    const { taskId } = runtime.beginTask(agent, { repo: REPO, prNumber: 7, kind: 'review' })

    const waiting = runtime.waitForPanelMessages(agent, { taskId, timeoutMs: 5_000 })
    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', text: 'Ping' }))
    const { messages } = await waiting
    expect(messages.map((m) => m.text)).toEqual(['Ping'])
    expect(messages[0].channel).toBe('tool_poll')
    const order = conn.frames.map((f) => f.type).filter((t) => t === 'messageQueued' || t === 'messageDelivered')
    expect(order).toEqual(['messageQueued', 'messageDelivered'])
    expect(conn.last('messageQueued')?.waitingForAgent).toBe(false)
  })

  it('wait_for_panel_messages returns [] on timeout and list_panel_messages marks delivered', async () => {
    const { runtime } = makeRuntime()
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd1', pr: PR }))
    const agent = runtime.connectAgent({ kind: 'codex', connectedAt: 1 })
    expect((await runtime.waitForPanelMessages(agent, { timeoutMs: 20 })).messages).toEqual([])
    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', text: 'Hello' }))
    expect(runtime.listPanelMessages(agent, {}).messages.map((m) => m.text)).toEqual(['Hello'])
    expect(runtime.listPanelMessages(agent, {}).messages).toEqual([])
    expect(runtime.queue.waiterCount).toBe(0)
  })
})

describe('HubRuntime: hook delivery', () => {
  function setup() {
    const { runtime } = makeRuntime()
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd1', pr: PR }))
    const agent = runtime.connectAgent({ kind: 'claude_code', connectedAt: 1 })
    const { taskId } = runtime.beginTask(agent, { repo: REPO, prNumber: 7, kind: 'review' })
    runtime.handleHook(hook('PostToolUse', { taskId }))
    return { runtime, conn, agent, taskId }
  }

  it('delivers a bound task message once through PreToolUse additionalContext', () => {
    const { runtime, conn } = setup()
    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', text: 'Check tests' }))
    expect(conn.last('messageQueued')?.waitingForAgent).toBe(false)

    const first = runtime.handleHook(hook('PreToolUse'))
    expect(first.channel).toBe('hook_context')
    expect(first.output?.hookSpecificOutput?.hookEventName).toBe('PreToolUse')
    expect(first.output?.hookSpecificOutput?.additionalContext).toContain('Check tests')
    expect(first.output?.hookSpecificOutput?.additionalContext).toContain('[PR #7')
    expect(conn.last('messageDelivered')?.channel).toBe('hook_context')

    const second = runtime.handleHook(hook('PostToolUse'))
    expect(second.output).toBeUndefined()
    expect(second.deliveredMessageIds).toEqual([])
  })

  it('Stop blocks with the message once, and never when stop_hook_active is true', () => {
    const { runtime, conn } = setup()
    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', text: 'One more thing' }))
    const guarded = runtime.handleHook(hook('Stop', { stopHookActive: true }))
    expect(guarded.output).toBeUndefined()
    expect(runtime.queue.pending()).toHaveLength(1)

    const blocked = runtime.handleHook(hook('Stop', { stopHookActive: false }))
    expect(blocked.output?.decision).toBe('block')
    expect(blocked.output?.reason).toContain('One more thing')
    expect(blocked.channel).toBe('stop_block')

    const again = runtime.handleHook(hook('Stop', { stopHookActive: false }))
    expect(again.output).toBeUndefined()
  })

  it('UserPromptSubmit delivers unbound messages for the active PR when the session has no working task', () => {
    const { runtime } = makeRuntime()
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd1', pr: PR }))
    runtime.connectAgent({ kind: 'claude_code', connectedAt: 1 })
    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', text: 'Review this please' }))
    const res = runtime.handleHook(hook('UserPromptSubmit', { sessionId: 'fresh' }))
    expect(res.channel).toBe('prompt_context')
    expect(res.output?.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit')
    expect(res.output?.hookSpecificOutput?.additionalContext).toContain('Review this please')
  })

  it('a message aimed at a finished task reaches the next session at turn start', () => {
    // Live 2026-10-23: the panel keeps showing the last task (Done) and sends its taskId with
    // every message. Bound to an ended task, the message never reached a later session by hook.
    const { runtime, conn, taskId } = setup()
    runtime.completeTask({ taskId, outcome: 'completed' })
    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', taskId, text: 'Next request' }))
    expect(runtime.queue.pending()[0]?.taskId).toBeUndefined()

    const res = runtime.handleHook(hook('UserPromptSubmit', { sessionId: 'next-session' }))
    expect(res.channel).toBe('prompt_context')
    expect(res.output?.hookSpecificOutput?.additionalContext).toContain('Next request')
  })

  it('does not hand a task-bound message to a session not bound to that task', () => {
    const { runtime, conn } = setup()
    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', text: 'For the task' }))
    const other = runtime.handleHook(hook('PreToolUse', { sessionId: 'other-session' }))
    expect(other.output).toBeUndefined()
    expect(runtime.queue.pending()).toHaveLength(1)
  })

  it('tracks turns: waitingForAgent flips after Stop and SessionEnd marks the session inactive', () => {
    const { runtime, conn } = setup()
    expect(runtime.hooks.anyInTurn()).toBe(true)
    runtime.handleHook(hook('Stop'))
    expect(runtime.hooks.anyInTurn()).toBe(false)
    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', text: 'later' }))
    expect(conn.last('messageQueued')?.waitingForAgent).toBe(true)
    runtime.handleHook(hook('SessionEnd'))
    expect(runtime.hooks.session('claude', 's1')?.ended).toBe(true)
  })

  it('tells a bound session once that the user pressed Stop', () => {
    const { runtime, conn, taskId } = setup()
    runtime.handleExtensionFrame(conn.id, frame('cancelTask', { taskId }))
    const res = runtime.handleHook(hook('PreToolUse'))
    expect(res.output?.hookSpecificOutput?.additionalContext).toMatch(/pressed Stop/)
    expect(runtime.handleHook(hook('PreToolUse')).output).toBeUndefined()
  })
})
