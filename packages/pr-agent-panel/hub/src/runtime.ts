/**
 * The Hub's in-memory core. No sockets here: the WebSocket server, the
 * consumer transport and the MCP server call into this class, and it talks
 * back through `ExtensionConnection.send`. Everything is synchronous except
 * the long-poll, so tests drive it directly.
 */
import { nanoid } from 'nanoid'
import { z } from 'zod'
import {
  PROTOCOL_VERSION,
  WAIT_FOR_MESSAGES_MAX_MS,
  repoKeyOf,
  type AgentClient,
  type ClientHookRequest,
  type ClientHookResponse,
  type DeliveryChannel,
  type ExtensionFrame,
  type HubFrame,
  type PageSession,
  type PanelMessage,
  type PrRef,
  type RepoRef,
  type ReviewRun,
  type Task,
  type TaskEventPayload,
  BeginTaskInput,
  CompleteTaskInput,
  ListPanelMessagesInput,
  PublishReviewInput,
  ReadReviewHistoryInput,
  WaitForPanelMessagesInput,
  GetActivePrOutput,
  BeginTaskOutput,
} from '@zenuml/pr-panel-shared'
import { ClientHooks } from './hooks'
import { MessageQueue, type MessagePredicate } from './message-queue'
import type { ReviewStore } from './review-store'
import type { Analytics } from './analytics'

export const HUB_VERSION = '0.1.0'
/** Ended tasks kept in the `state` frame (working tasks are always included). */
export const MAX_ENDED_TASKS_IN_STATE = 20

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type HubFrameBody = DistributiveOmit<HubFrame, 'v' | 'id' | 'ts'>

export interface ExtensionConnection {
  readonly id: string
  send(frame: HubFrame): void
}

/** Thrown by tool handlers; the MCP layer turns it into an `isError` result. */
export class ToolError extends Error {
  constructor(
    readonly code: 'unknown_task' | 'task_not_working' | 'no_active_pr',
    message: string,
  ) {
    super(message)
  }
}

interface TaskRecord {
  task: Task
  repo: RepoRef
  consumerId: string
  seq: number
  turnsEnded: number
  findingCount: number
}

interface SessionRecord {
  session: PageSession
  connId: string
}

export interface RuntimeOptions {
  store: ReviewStore
  analytics?: Analytics
  now?: () => number
  createId?: () => string
  hubVersion?: string
}

type BeginTaskArgs = z.output<typeof BeginTaskInput>
type PublishReviewArgs = z.output<typeof PublishReviewInput>
type CompleteTaskArgs = z.output<typeof CompleteTaskInput>
type ReadReviewHistoryArgs = z.output<typeof ReadReviewHistoryInput>
type ListPanelMessagesArgs = z.output<typeof ListPanelMessagesInput>
type WaitForPanelMessagesArgs = z.output<typeof WaitForPanelMessagesInput>

export class HubRuntime {
  readonly store: ReviewStore
  readonly hooks: ClientHooks
  readonly queue: MessageQueue
  readonly hubVersion: string
  private readonly analytics: Analytics | undefined
  private readonly now: () => number
  private readonly createId: () => string

  private readonly connections = new Map<string, ExtensionConnection>()
  private readonly helloed = new Set<string>()
  private readonly sessions = new Map<string, SessionRecord>()
  private activeDocumentId: string | null = null
  private readonly agents = new Map<string, AgentClient>()
  private readonly tasks = new Map<string, TaskRecord>()
  /** Task ids the user cancelled; a bound hook session gets one notice each. */
  private readonly cancelNotices = new Set<string>()
  private readonly listeners = new Set<() => void>()

  constructor(options: RuntimeOptions) {
    this.store = options.store
    this.analytics = options.analytics
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? (() => nanoid())
    this.hubVersion = options.hubVersion ?? HUB_VERSION
    this.queue = new MessageQueue((messages, channel) => this.onDelivered(messages, channel), this.now)
    this.hooks = new ClientHooks({
      now: this.now,
      isWorkingTask: (taskId) => this.tasks.get(taskId)?.task.status === 'working',
      activePr: () => {
        const pr = this.activePr()
        return pr ? { repoKey: repoKeyOf(pr), prNumber: pr.number } : null
      },
      deliver: (predicate, channel) => this.queue.deliver(predicate, channel),
      takeNotices: (taskIds) => this.takeNotices(taskIds),
      turnEnded: (taskIds) => {
        for (const id of taskIds) {
          const record = this.tasks.get(id)
          if (record?.task.status === 'working') record.turnsEnded += 1
        }
      },
    })
  }

  // ------------------------------------------------------------ observers

  /** Called after any change the Hub's lifetime logic may care about (agents connect/disconnect). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get agentCount(): number {
    return this.agents.size
  }

  get connectionCount(): number {
    return this.connections.size
  }

  // ------------------------------------------------------------ extension side

  attachExtension(connection: ExtensionConnection): void {
    this.connections.set(connection.id, connection)
  }

  detachExtension(connId: string): void {
    this.connections.delete(connId)
    this.helloed.delete(connId)
    let changed = false
    for (const [documentId, record] of this.sessions) {
      if (record.connId !== connId) continue
      this.sessions.delete(documentId)
      if (this.activeDocumentId === documentId) this.activeDocumentId = null
      changed = true
    }
    if (changed) this.pushState()
  }

  /** Answer an unparseable frame. */
  rejectFrame(connId: string, message: string, inReplyTo?: string): void {
    const conn = this.connections.get(connId)
    if (conn) this.sendTo(conn, { type: 'error', code: 'bad_frame', message, ...(inReplyTo ? { inReplyTo } : {}) })
  }

  /** Returns `close: true` when the connection must be closed after the reply (protocol mismatch). */
  handleExtensionFrame(connId: string, frame: ExtensionFrame): { close: boolean } {
    const conn = this.connections.get(connId)
    if (!conn) return { close: true }
    if (frame.type !== 'hello' && !this.helloed.has(connId)) {
      this.sendTo(conn, { type: 'error', code: 'bad_frame', message: 'Send hello first.', inReplyTo: frame.id })
      return { close: false }
    }
    switch (frame.type) {
      case 'hello': {
        if (frame.protocolVersion !== PROTOCOL_VERSION) {
          this.sendTo(conn, {
            type: 'error',
            code: 'protocol_mismatch',
            message: `Hub speaks protocol ${PROTOCOL_VERSION}; extension sent ${frame.protocolVersion}.`,
            inReplyTo: frame.id,
          })
          return { close: true }
        }
        this.helloed.add(connId)
        this.sendTo(conn, {
          type: 'registered',
          protocolVersion: PROTOCOL_VERSION,
          hubVersion: this.hubVersion,
          inReplyTo: frame.id,
        })
        this.sendTo(conn, this.stateBody())
        return { close: false }
      }
      case 'register': {
        this.sessions.set(frame.documentId, {
          connId,
          session: { documentId: frame.documentId, pr: frame.pr, registeredAt: this.now() },
        })
        if (this.activeDocumentId === null) this.activeDocumentId = frame.documentId
        // A tab that shows the PR of a working task without a tab gets that task.
        for (const record of this.tasks.values()) {
          if (record.task.status === 'working' && !record.task.documentId && this.samePr(record, frame.pr)) {
            record.task = { ...record.task, documentId: frame.documentId }
          }
        }
        this.pushState()
        return { close: false }
      }
      case 'unregister': {
        if (this.sessions.delete(frame.documentId)) {
          if (this.activeDocumentId === frame.documentId) this.activeDocumentId = null
          this.pushState()
        }
        return { close: false }
      }
      case 'activate': {
        if (!this.sessions.has(frame.documentId)) {
          this.sendTo(conn, { type: 'error', code: 'unknown_document', message: 'Tab is not registered.', inReplyTo: frame.id })
          return { close: false }
        }
        this.activeDocumentId = frame.documentId
        this.pushState()
        return { close: false }
      }
      case 'listReviews': {
        this.sendTo(conn, this.reviewsBody(frame.repoKey, frame.currentHeadSha, frame.id))
        return { close: false }
      }
      case 'userMessage':
        this.onUserMessage(conn, frame)
        return { close: false }
      case 'cancelTask': {
        const record = this.tasks.get(frame.taskId)
        if (!record) {
          this.sendTo(conn, { type: 'error', code: 'unknown_task', message: 'No such task.', inReplyTo: frame.id })
        } else if (record.task.status !== 'working') {
          this.sendTo(conn, {
            type: 'error',
            code: 'task_not_cancellable',
            message: `Task is ${record.task.status}.`,
            inReplyTo: frame.id,
          })
        } else {
          this.endTask(record, 'cancelled')
          this.cancelNotices.add(record.task.taskId)
        }
        return { close: false }
      }
      case 'ping':
        this.sendTo(conn, { type: 'pong', inReplyTo: frame.id })
        return { close: false }
      case 'telemetry':
        this.analytics?.track(frame.event, frame.props)
        return { close: false }
    }
  }

  private onUserMessage(conn: ExtensionConnection, frame: Extract<ExtensionFrame, { type: 'userMessage' }>): void {
    const record = this.sessions.get(frame.documentId)
    if (!record) {
      this.sendTo(conn, { type: 'error', code: 'unknown_document', message: 'Tab is not registered.', inReplyTo: frame.id })
      return
    }
    const pr = record.session.pr
    const repoKey = repoKeyOf(pr)
    let taskId = frame.taskId
    if (taskId && !this.tasks.has(taskId)) {
      this.sendTo(conn, { type: 'error', code: 'unknown_task', message: 'No such task.', inReplyTo: frame.id })
      return
    }
    taskId ??= this.workingTaskFor(repoKey, pr.number)?.task.taskId
    const message: PanelMessage = {
      messageId: this.createId(),
      ...(taskId ? { taskId } : {}),
      documentId: frame.documentId,
      repoKey,
      prNumber: pr.number,
      text: frame.text,
      createdAt: this.now(),
    }
    const { waiterMatched } = this.queue.enqueue(message)
    const agentWillSeeIt = waiterMatched || (this.agents.size > 0 && this.hooks.anyInTurn())
    this.sendTo(conn, { type: 'messageQueued', messageId: message.messageId, inReplyTo: frame.id, waitingForAgent: !agentWillSeeIt })
    this.analytics?.track('pr_panel_message_queued', {})
    this.queue.dispatchWaiters()
  }

  // ------------------------------------------------------------ agent side

  connectAgent(client: AgentClient): string {
    const consumerId = this.createId()
    this.agents.set(consumerId, client)
    this.pushState()
    this.notify()
    return consumerId
  }

  /** The consumer's identity is learned from its first `client-event`; it may arrive after connect. */
  updateAgent(consumerId: string, client: AgentClient): void {
    if (!this.agents.has(consumerId)) return
    this.agents.set(consumerId, client)
    this.pushState()
  }

  disconnectAgent(consumerId: string): void {
    if (!this.agents.delete(consumerId)) return
    this.pushState()
    this.notify()
  }

  agentOf(consumerId: string): AgentClient {
    return this.agents.get(consumerId) ?? { kind: 'other', connectedAt: this.now() }
  }

  handleHook(request: ClientHookRequest): ClientHookResponse {
    return this.hooks.handle(request)
  }

  getActivePr(): z.output<typeof GetActivePrOutput> {
    const active = this.activeDocumentId ? this.sessions.get(this.activeDocumentId) : undefined
    const seen = new Set<string>()
    if (active) seen.add(prKey(active.session.pr))
    const otherPrs: PrRef[] = []
    for (const record of this.sessions.values()) {
      const key = prKey(record.session.pr)
      if (seen.has(key)) continue
      seen.add(key)
      otherPrs.push(record.session.pr)
    }
    return { pr: active?.session.pr ?? null, documentId: active?.session.documentId ?? null, otherPrs }
  }

  beginTask(consumerId: string, input: BeginTaskArgs): z.output<typeof BeginTaskOutput> {
    const repoKey = repoKeyOf(input.repo)
    const session = this.sessionShowing(repoKey, input.prNumber)
    const resumed =
      [...this.tasks.values()].some((r) => r.task.repoKey === repoKey && r.task.prNumber === input.prNumber) ||
      this.store.history(repoKey, input.prNumber, 1).length > 0
    const headSha = input.headSha ?? session?.pr.headSha
    const task: Task = {
      taskId: this.createId(),
      kind: input.kind,
      repoKey,
      prNumber: input.prNumber,
      ...(headSha ? { headSha } : {}),
      ...(session ? { documentId: session.documentId } : {}),
      agent: this.agentOf(consumerId),
      status: 'working',
      ...(input.label ? { label: input.label } : {}),
      startedAt: this.now(),
    }
    const record: TaskRecord = { task, repo: input.repo, consumerId, seq: 0, turnsEnded: 0, findingCount: 0 }
    this.tasks.set(task.taskId, record)
    this.emitTaskEvent(record, { kind: 'started', task })
    this.pushState()
    this.analytics?.track('pr_panel_task_started', { task_kind: task.kind, agent_kind: task.agent.kind, resumed })
    const pendingMessages = this.queue.deliver(
      (m) => m.repoKey === repoKey && m.prNumber === input.prNumber,
      'tool_poll',
    )
    return { taskId: task.taskId, documentId: task.documentId ?? null, pendingMessages }
  }

  reportProgress(taskId: string, text: string): { ok: true } {
    const record = this.workingTask(taskId)
    record.task = { ...record.task, label: text }
    this.emitTaskEvent(record, { kind: 'progress', text })
    this.pushState()
    return { ok: true }
  }

  postMessage(taskId: string, text: string): { ok: true } {
    const record = this.workingTask(taskId)
    this.emitTaskEvent(record, { kind: 'message', text })
    return { ok: true }
  }

  publishReview(input: PublishReviewArgs): { runId: string } {
    const record = this.workingTask(input.taskId)
    const { task } = record
    const session = this.sessionShowing(task.repoKey, task.prNumber)
    const reviewedHeadSha = input.headSha ?? task.headSha ?? '0000000'
    const pr: PrRef = {
      ...(session?.pr ?? { ...record.repo, number: task.prNumber }),
      headSha: reviewedHeadSha,
    }
    const run: ReviewRun = {
      runId: this.createId(),
      repoKey: task.repoKey,
      pr,
      reviewedHeadSha,
      status: 'completed',
      headline: input.headline,
      summary: input.summary,
      ...(input.priority ? { priority: input.priority } : {}),
      findings: input.findings.map((f, i) => ({ ...f, id: `f${i + 1}` })),
      tags: input.tags,
      prState: input.prState,
      ...(input.mergeable !== undefined ? { mergeable: input.mergeable } : {}),
      startedAt: task.startedAt,
      completedAt: this.now(),
      agentKind: task.agent.kind,
      ...(task.agent.sessionId ? { agentSessionId: task.agent.sessionId } : {}),
    }
    this.store.upsert(run)
    record.task = { ...task, runId: run.runId }
    record.findingCount = run.findings.length
    this.emitTaskEvent(record, { kind: 'published', runId: run.runId })
    this.broadcast(this.reviewsBody(task.repoKey))
    this.pushState()
    return { runId: run.runId }
  }

  completeTask(input: CompleteTaskArgs): { task: Task } {
    const record = this.tasks.get(input.taskId)
    if (!record) throw new ToolError('unknown_task', `No task ${input.taskId}.`)
    // Already ended (e.g. the user pressed Stop): report the final state, do not overwrite it.
    if (record.task.status !== 'working') return { task: record.task }
    this.endTask(record, input.outcome, input.reason)
    return { task: record.task }
  }

  readReviewHistory(input: ReadReviewHistoryArgs): { runs: ReviewRun[] } {
    return { runs: this.store.history(repoKeyOf(input.repo), input.prNumber, input.limit) }
  }

  listPanelMessages(consumerId: string, input: ListPanelMessagesArgs): { messages: PanelMessage[] } {
    const base = this.agentPredicate(consumerId, input.taskId)
    const since = input.since
    const messages = this.queue.deliver((m) => base(m) && (since === undefined || m.createdAt > since), 'tool_poll')
    return { messages }
  }

  async waitForPanelMessages(
    consumerId: string,
    input: WaitForPanelMessagesArgs,
    signal?: AbortSignal,
  ): Promise<{ messages: PanelMessage[] }> {
    const timeout = Math.min(Math.max(input.timeoutMs, 1), WAIT_FOR_MESSAGES_MAX_MS)
    const messages = await this.queue.waitFor(this.agentPredicate(consumerId, input.taskId), timeout, signal)
    return { messages }
  }

  /** Snapshot for tests and the `state` frame. */
  snapshot(): Extract<HubFrameBody, { type: 'state' }> {
    return this.stateBody()
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId)?.task
  }

  // ------------------------------------------------------------ internals

  /**
   * Which messages a tool call may take. With `taskId`: that task's messages
   * plus unbound ones for its PR. Without: messages bound to this consumer's
   * tasks plus unbound ones for the active PR.
   */
  private agentPredicate(consumerId: string, taskId?: string): MessagePredicate {
    if (taskId) {
      const record = this.tasks.get(taskId)
      if (!record) throw new ToolError('unknown_task', `No task ${taskId}.`)
      const { repoKey, prNumber } = record.task
      return (m) => m.taskId === taskId || (!m.taskId && m.repoKey === repoKey && m.prNumber === prNumber)
    }
    const own = new Set([...this.tasks.values()].filter((r) => r.consumerId === consumerId).map((r) => r.task.taskId))
    const active = this.activePr()
    const activeKey = active ? repoKeyOf(active) : null
    return (m) => {
      if (m.taskId) return own.has(m.taskId)
      return active !== null && m.repoKey === activeKey && m.prNumber === active.number
    }
  }

  private onDelivered(messages: PanelMessage[], channel: DeliveryChannel): void {
    for (const m of messages) {
      this.broadcast({ type: 'messageDelivered', messageId: m.messageId, channel })
      this.analytics?.track('pr_panel_message_delivered', { delivery_channel: channel })
    }
  }

  private endTask(record: TaskRecord, outcome: 'completed' | 'cancelled' | 'failed', reason?: string): void {
    const status = outcome === 'completed' ? 'finished' : outcome
    const endedAt = this.now()
    record.task = { ...record.task, status, endedAt }
    if (outcome === 'failed') this.emitTaskEvent(record, { kind: 'failed', reason: (reason ?? 'The agent reported a failure.').slice(0, 500) })
    else this.emitTaskEvent(record, { kind: outcome })
    this.pushState()
    this.analytics?.track('pr_panel_task_completed', {
      task_outcome: outcome,
      duration_ms: endedAt - record.task.startedAt,
      finding_count: record.findingCount,
      // The turn that ends the task has not seen its Stop yet: count it.
      turn_count: record.turnsEnded + 1,
    })
  }

  private takeNotices(taskIds: ReadonlySet<string>): string[] {
    const notices: string[] = []
    for (const id of taskIds) {
      if (!this.cancelNotices.delete(id)) continue
      const task = this.tasks.get(id)?.task
      notices.push(
        `The user pressed Stop in the ZenUML PR Agent Panel: task ${id}${task ? ` (PR #${task.prNumber})` : ''} is cancelled. Stop working on it and do not publish a review for it.`,
      )
    }
    return notices
  }

  private workingTask(taskId: string): TaskRecord {
    const record = this.tasks.get(taskId)
    if (!record) throw new ToolError('unknown_task', `No task ${taskId}.`)
    if (record.task.status !== 'working') {
      throw new ToolError(
        'task_not_working',
        record.task.status === 'cancelled'
          ? `Task ${taskId} was cancelled by the user. Stop working on it.`
          : `Task ${taskId} is ${record.task.status}.`,
      )
    }
    return record
  }

  private workingTaskFor(repoKey: string, prNumber: number): TaskRecord | undefined {
    let latest: TaskRecord | undefined
    for (const record of this.tasks.values()) {
      const t = record.task
      if (t.status === 'working' && t.repoKey === repoKey && t.prNumber === prNumber) {
        if (!latest || t.startedAt >= latest.task.startedAt) latest = record
      }
    }
    return latest
  }

  private activePr(): PrRef | null {
    if (!this.activeDocumentId) return null
    return this.sessions.get(this.activeDocumentId)?.session.pr ?? null
  }

  /** The tab showing this PR, preferring the active one. */
  private sessionShowing(repoKey: string, prNumber: number): PageSession | undefined {
    const matches = [...this.sessions.values()]
      .map((r) => r.session)
      .filter((s) => repoKeyOf(s.pr) === repoKey && s.pr.number === prNumber)
    return matches.find((s) => s.documentId === this.activeDocumentId) ?? matches[0]
  }

  private samePr(record: TaskRecord, pr: PrRef): boolean {
    return record.task.repoKey === repoKeyOf(pr) && record.task.prNumber === pr.number
  }

  private reviewsBody(repoKey: string, currentHeadSha?: string, inReplyTo?: string): Extract<HubFrameBody, { type: 'reviews' }> {
    const key = repoKey.toLowerCase()
    const heads = new Map<number, string>()
    const repoSessions = [...this.sessions.values()].map((r) => r.session).filter((s) => repoKeyOf(s.pr) === key)
    for (const s of repoSessions) if (s.pr.headSha) heads.set(s.pr.number, s.pr.headSha)
    // `listReviews` names a head but not a PR: attach it to the one tab of this repo when that is unambiguous.
    if (currentHeadSha && ![...heads.values()].some((h) => h.toLowerCase() === currentHeadSha.toLowerCase())) {
      const numbers = new Set(repoSessions.map((s) => s.pr.number))
      if (numbers.size === 1) heads.set([...numbers][0], currentHeadSha)
    }
    return {
      type: 'reviews',
      repoKey: key,
      items: this.store.listLatestCompleted(key, heads),
      ...(inReplyTo ? { inReplyTo } : {}),
    }
  }

  private stateBody(): Extract<HubFrameBody, { type: 'state' }> {
    const all = [...this.tasks.values()].map((r) => r.task)
    const working = all.filter((t) => t.status === 'working')
    const ended = all
      .filter((t) => t.status !== 'working')
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .slice(0, MAX_ENDED_TASKS_IN_STATE)
    return {
      type: 'state',
      activeDocumentId: this.activeDocumentId,
      sessions: [...this.sessions.values()].map((r) => r.session),
      agents: [...this.agents.values()],
      tasks: [...working, ...ended],
    }
  }

  private emitTaskEvent(record: TaskRecord, event: TaskEventPayload): void {
    const seq = record.seq
    record.seq += 1
    this.broadcast({
      type: 'taskEvent',
      taskId: record.task.taskId,
      seq,
      ...(record.task.documentId ? { documentId: record.task.documentId } : {}),
      event,
    })
  }

  private pushState(): void {
    if (!this.helloed.size) return
    this.broadcast(this.stateBody())
  }

  private broadcast(body: HubFrameBody): void {
    for (const conn of this.connections.values()) {
      if (this.helloed.has(conn.id)) this.sendTo(conn, body)
    }
  }

  private sendTo(conn: ExtensionConnection, body: HubFrameBody): void {
    conn.send({ ...body, v: 1, id: this.createId(), ts: this.now() } as HubFrame)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

function prKey(pr: PrRef): string {
  return `${repoKeyOf(pr)}#${pr.number}`
}
