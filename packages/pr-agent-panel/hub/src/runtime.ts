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
  effectiveReadiness,
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
  DeleteReviewEntryInput,
  WaitForPanelMessagesInput,
  GetActivePrOutput,
  BeginTaskOutput,
  type ReviewGroup,
  type ReviewGroupPreparation,
  type ReviewGroupItem,
  StartReviewGroupInput,
  PublishReviewGroupInput,
  FailReviewGroupInput,
  BindReviewActionInput,
  RefreshReviewMaterialInput,
} from '@zenuml/pr-panel-shared'
import { ClientHooks } from './hooks'
import { MessageQueue, type MessagePredicate } from './message-queue'
import type { ReviewStore } from './review-store'
import type { PrStatusStore } from './pr-status-store'
import type { Analytics } from './analytics'
import type { ReviewGroupStore } from './review-group-store'
import { GhReviewGateway, type ReviewGateway } from './github-review-gateway'

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
  groupStore?: Pick<ReviewGroupStore, 'get' | 'put'>
  reviewGateway?: ReviewGateway
  statuses?: PrStatusStore
  requestStatusSync?: () => void
  analytics?: Analytics
  now?: () => number
  createId?: () => string
  hubVersion?: string
}

type BeginTaskArgs = z.output<typeof BeginTaskInput>
type PublishReviewArgs = z.output<typeof PublishReviewInput>
type CompleteTaskArgs = z.output<typeof CompleteTaskInput>
type ReadReviewHistoryArgs = z.output<typeof ReadReviewHistoryInput>
type DeleteReviewEntryArgs = z.output<typeof DeleteReviewEntryInput>
type ListPanelMessagesArgs = z.output<typeof ListPanelMessagesInput>
type WaitForPanelMessagesArgs = z.output<typeof WaitForPanelMessagesInput>
type StartReviewGroupArgs = z.output<typeof StartReviewGroupInput>
type PublishReviewGroupArgs = z.output<typeof PublishReviewGroupInput>
type FailReviewGroupArgs = z.output<typeof FailReviewGroupInput>
type BindReviewActionArgs = z.output<typeof BindReviewActionInput>
type RefreshReviewMaterialArgs = z.output<typeof RefreshReviewMaterialInput>

interface BoundReviewAction {
  groupId: string
  repoKey: string
  prNumber: number
  expectedHeadSha: string
  action: 'merge' | 'close'
  documentId?: string
}

export class HubRuntime {
  readonly store: ReviewStore
  readonly hooks: ClientHooks
  readonly queue: MessageQueue
  readonly hubVersion: string
  private readonly analytics: Analytics | undefined
  private readonly statuses: PrStatusStore | undefined
  private readonly requestStatusSync: (() => void) | undefined
  private readonly now: () => number
  private readonly createId: () => string
  private readonly groupStore: RuntimeOptions['groupStore']
  private readonly reviewGateway: ReviewGateway
  private group: ReviewGroup | null
  private preparation: ReviewGroupPreparation | null = null
  private readonly boundActions = new Map<string, BoundReviewAction>()
  private readonly materialWrites = new Map<string, Promise<void>>()
  private readonly nativeFeedbackSent = new Set<string>()

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
    this.groupStore = options.groupStore
    this.reviewGateway = options.reviewGateway ?? new GhReviewGateway()
    this.group = options.groupStore?.get() ?? null
    this.statuses = options.statuses
    this.requestStatusSync = options.requestStatusSync
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
        this.sendTo(conn, this.groupBody())
        this.requestStatusSync?.()
        return { close: false }
      }
      case 'register': {
        this.sessions.set(frame.documentId, {
          connId,
          session: { documentId: frame.documentId, pr: frame.pr, registeredAt: this.now() },
        })
        // Kept as a fallback for older extension clients; current clients send activate
        // for the foreground browser tab immediately after registration.
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
      case 'clearActive':
        this.activeDocumentId = null
        this.pushState()
        return { close: false }
      case 'listReviews': {
        this.sendTo(conn, this.reviewsBody(frame.repoKey, frame.currentHeadSha, frame.id))
        this.requestStatusSync?.()
        return { close: false }
      }
      case 'listGroup':
        this.sendTo(conn, { ...this.groupBody(), inReplyTo: frame.id })
        return { close: false }
      case 'nativeResultHint': {
        const session = this.sessions.get(frame.documentId)?.session
        if (!session || repoKeyOf(session.pr) !== repoKeyOf(frame.pr) || session.pr.number !== frame.pr.number) {
          this.sendTo(conn, { type: 'error', code: 'unknown_document', message: 'PR tab is not registered.', inReplyTo: frame.id })
        } else {
          void this.confirmNativeResult(frame.groupId, frame.pr, frame.action, frame.documentId)
            .catch(() => undefined)
        }
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
    const named = taskId ? this.tasks.get(taskId) : undefined
    if (taskId && !named) {
      this.sendTo(conn, { type: 'error', code: 'unknown_task', message: 'No such task.', inReplyTo: frame.id })
      return
    }
    // The panel keeps showing the last task after it ends and still names it. A message for an
    // ended task is a new request: route it like an unbound one, so the next session gets it.
    if (named && named.task.status !== 'working') taskId = undefined
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
      ...(input.authorLogin ? { authorLogin: input.authorLogin } : {}),
      startedAt: task.startedAt,
      completedAt: this.now(),
      agentKind: task.agent.kind,
      ...(task.agent.sessionId ? { agentSessionId: task.agent.sessionId } : {}),
    }
    this.store.upsert(run)
    this.requestStatusSync?.()
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

  deleteReviewEntry(input: DeleteReviewEntryArgs): { deleted: boolean; deletedRuns: number } {
    this.analytics?.track('pr_panel_review_entry_delete_requested')
    const repoKey = repoKeyOf(input.repo)
    try {
      const deletedRuns = this.store.deleteForPr(repoKey, input.prNumber)
      if (deletedRuns > 0) this.statuses?.delete(repoKey, input.prNumber)
      if (deletedRuns > 0) this.broadcast(this.reviewsBody(repoKey))
      this.analytics?.track('pr_panel_review_entry_delete_completed', {
        delete_outcome: deletedRuns > 0 ? 'deleted' : 'not_found',
        deleted_run_count: deletedRuns,
      })
      return { deleted: deletedRuns > 0, deletedRuns }
    } catch (error) {
      this.analytics?.track('pr_panel_review_entry_delete_completed', { delete_outcome: 'failed' })
      throw error
    }
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

  getReviewGroup(): { group: ReviewGroup | null; preparation: ReviewGroupPreparation | null } {
    return { group: this.group, preparation: this.preparation }
  }

  startReviewGroup(input: StartReviewGroupArgs): { requestId: string; previousGroup: ReviewGroup | null } {
    const requestId = this.createId()
    const previousGroup = this.group
    this.preparation = { requestId, product: input.product, ...(input.focus ? { focus: input.focus } : {}), requestedCount: input.requestedCount, startedAt: this.now() }
    this.broadcast(this.groupBody())
    this.analytics?.track('pr_panel_group_prepare_requested', { requested_pr_count: input.requestedCount })
    return { requestId, previousGroup }
  }

  async publishReviewGroup(input: PublishReviewGroupArgs): Promise<{ group: ReviewGroup }> {
    const prep = this.preparation
    if (!prep || prep.requestId !== input.requestId || prep.error) throw new Error('This preparation is no longer current.')
    if (input.items.length > prep.requestedCount) throw new Error('Prepared items exceed the requested count.')
    const seen = new Set<string>()
    for (const item of input.items) {
      const key = `${repoKeyOf(item.pr)}#${item.pr.number}`
      if (seen.has(key)) throw new Error(`Duplicate PR ${key}.`)
      seen.add(key)
      if (item.pr.headSha && item.pr.headSha.toLowerCase() !== item.materialHeadSha.toLowerCase()) {
        throw new Error(`PR #${item.pr.number} material head differs from its prepared head.`)
      }
    }
    try {
      // Preflight the entire selection before the first GitHub write. Every write
      // checks again, since a PR can change between this read and its update.
      for (const item of input.items) {
        const remote = await this.reviewGateway.read(item.pr)
        if (remote.state !== 'open' || remote.headSha.toLowerCase() !== item.materialHeadSha.toLowerCase()) {
          throw new Error(`PR #${item.pr.number} is no longer open at the prepared head.`)
        }
      }
      for (const item of input.items) {
        if (this.preparation?.requestId !== input.requestId) throw new Error('A newer review request replaced this one.')
        await this.withMaterialWrite(item.pr, async () => {
          if (this.preparation?.requestId !== input.requestId) throw new Error('A newer review request replaced this one.')
          await this.reviewGateway.writeMaterials(item.pr, item.materialHeadSha, item.materialsMarkdown,
            () => this.preparation?.requestId === input.requestId)
        })
      }
      if (this.preparation?.requestId !== input.requestId) throw new Error('A newer review request replaced this one.')
      const now = this.now()
      const group: ReviewGroup = {
        groupId: input.requestId,
        product: prep.product,
        ...(prep.focus ? { focus: prep.focus } : {}),
        requestedCount: prep.requestedCount,
        status: input.items.length ? 'ready' : 'zero',
        items: input.items.map(({ materialsMarkdown: _markdown, ...item }) => ({
          ...item, pr: { ...item.pr, headSha: item.materialHeadSha }, materialUpdatedAt: now, outcome: 'pending' as const,
        })),
        createdAt: prep.startedAt,
        updatedAt: now,
      }
      this.groupStore?.put(group)
      this.group = group
      this.preparation = null
      this.nativeFeedbackSent.clear()
      this.broadcast(this.groupBody())
      this.analytics?.track('pr_panel_group_published', {
        requested_pr_count: prep.requestedCount,
        prepared_pr_count: group.items.length,
        group_outcome: group.status,
      })
      return { group }
    } catch (error) {
      if (this.preparation?.requestId === input.requestId) {
        this.preparation = { ...prep, error: error instanceof Error ? error.message.slice(0, 500) : 'Preparation failed.' }
        this.broadcast(this.groupBody())
        this.analytics?.track('pr_panel_group_prepare_failed', { group_outcome: 'failed' })
      }
      throw error
    }
  }

  failReviewGroup(input: FailReviewGroupArgs): { ok: true } {
    if (this.preparation?.requestId !== input.requestId) throw new Error('This preparation is no longer current.')
    this.preparation = { ...this.preparation, error: input.reason }
    this.broadcast(this.groupBody())
    this.analytics?.track('pr_panel_group_prepare_failed', { group_outcome: 'failed' })
    return { ok: true }
  }

  bindReviewAction(input: BindReviewActionArgs): { actionId: string; documentId: string | null } {
    const item = this.pendingGroupItem(input.groupId, repoKeyOf(input.repo), input.prNumber)
    if (item.materialHeadSha.toLowerCase() !== input.expectedHeadSha.toLowerCase()) throw new Error('The prepared head changed. Refresh the material first.')
    const session = this.sessionShowing(repoKeyOf(input.repo), input.prNumber)
    const actionId = this.createId()
    this.boundActions.set(actionId, {
      groupId: input.groupId, repoKey: repoKeyOf(input.repo), prNumber: input.prNumber,
      expectedHeadSha: input.expectedHeadSha, action: input.action,
      ...(session ? { documentId: session.documentId } : {}),
    })
    return { actionId, documentId: session?.documentId ?? null }
  }

  async confirmReviewAction(actionId: string): Promise<{ confirmed: boolean; outcome?: 'merged' | 'closed' }> {
    const bound = this.boundActions.get(actionId)
    if (!bound) throw new Error('Unknown action. Bind the target before acting.')
    const item = this.pendingGroupItem(bound.groupId, bound.repoKey, bound.prNumber)
    if (item.materialHeadSha.toLowerCase() !== bound.expectedHeadSha.toLowerCase()) throw new Error('The target head changed.')
    const outcome = await this.confirmRemoteResult(bound.groupId, item.pr, bound.action, 'ai', bound.documentId, bound.expectedHeadSha)
    if (outcome) this.boundActions.delete(actionId)
    return outcome ? { confirmed: true, outcome } : { confirmed: false }
  }

  async refreshReviewMaterial(input: RefreshReviewMaterialArgs): Promise<{ item: ReviewGroupItem }> {
    const repoKey = repoKeyOf(input.repo)
    const item = this.pendingGroupItem(input.groupId, repoKey, input.prNumber)
    await this.withMaterialWrite(item.pr, async () => {
      const current = this.pendingGroupItem(input.groupId, repoKey, input.prNumber)
      await this.reviewGateway.writeMaterials(current.pr, input.expectedHeadSha, input.materialsMarkdown,
        () => this.group?.groupId === input.groupId && this.group.items.some((x) => repoKeyOf(x.pr) === repoKey && x.pr.number === input.prNumber && x.outcome === 'pending'))
    })
    if (this.group?.groupId !== input.groupId) throw new Error('Review group changed during material refresh.')
    const current = this.group.items.find((x) => repoKeyOf(x.pr) === repoKey && x.pr.number === input.prNumber)
    if (!current) throw new Error('Review item changed during material refresh.')
    if (current.outcome !== 'pending') return { item: current }
    const updated = { ...current, pr: { ...current.pr, headSha: input.expectedHeadSha }, materialHeadSha: input.expectedHeadSha, materialUpdatedAt: this.now(), ci: input.ci }
    this.replaceGroupItem(updated)
    return { item: updated }
  }

  private async withMaterialWrite<T>(pr: PrRef, write: () => Promise<T>): Promise<T> {
    const key = `${repoKeyOf(pr)}#${pr.number}`
    const previous = this.materialWrites.get(key) ?? Promise.resolve()
    let release!: () => void
    const turn = new Promise<void>((resolve) => { release = resolve })
    this.materialWrites.set(key, turn)
    await previous
    try { return await write() }
    finally {
      release()
      if (this.materialWrites.get(key) === turn) this.materialWrites.delete(key)
    }
  }

  /** Poll remote facts for this finite set; external completions never carry an originating tab. */
  async refreshGroupFacts(): Promise<void> {
    const group = this.group
    if (!group || group.status !== 'ready') return
    for (const item of group.items.filter((value) => value.outcome === 'pending')) {
      if (this.group?.groupId !== group.groupId) return
      try {
        const remote = await this.reviewGateway.read(item.pr)
        if (this.group?.groupId !== group.groupId) return
        const current = this.group.items.find((value) => repoKeyOf(value.pr) === repoKeyOf(item.pr) && value.pr.number === item.pr.number)
        if (!current || current.outcome !== 'pending') continue
        if (remote.state === 'merged' || remote.state === 'closed') {
          this.replaceGroupItem({ ...current, outcome: remote.state })
          this.broadcast({ type: 'reviewItemResult', groupId: group.groupId, pr: current.pr, outcome: remote.state, source: 'external' })
          this.analytics?.track('pr_panel_group_item_completed', {
            completion_source: 'external', completion_outcome: remote.state,
            remaining_pr_count: this.group?.items.filter((value) => value.outcome === 'pending').length ?? 0,
          })
          continue
        }
        const ci = await this.reviewGateway.readCi?.(item.pr)
        if (ci && this.group?.groupId === group.groupId) {
          const latest = this.group.items.find((value) => repoKeyOf(value.pr) === repoKeyOf(item.pr) && value.pr.number === item.pr.number)
          if (latest?.outcome === 'pending' && ci !== latest.ci) this.replaceGroupItem({ ...latest, ci })
        }
      } catch { /* Offline or rate limited: preserve the last known state. */ }
    }
  }

  private pendingGroupItem(groupId: string, repoKey: string, prNumber: number): ReviewGroupItem {
    const item = this.group?.groupId === groupId
      ? this.group.items.find((x) => repoKeyOf(x.pr) === repoKey && x.pr.number === prNumber)
      : undefined
    if (!item || item.outcome !== 'pending') throw new Error('PR is not pending in the current review group.')
    return item
  }

  private replaceGroupItem(updated: ReviewGroupItem): void {
    if (!this.group) return
    const group: ReviewGroup = {
      ...this.group,
      items: this.group.items.map((x) => repoKeyOf(x.pr) === repoKeyOf(updated.pr) && x.pr.number === updated.pr.number ? updated : x),
      updatedAt: this.now(),
    }
    group.status = group.items.every((x) => x.outcome !== 'pending') ? 'completed' : 'ready'
    this.groupStore?.put(group)
    this.group = group
    this.broadcast(this.groupBody())
  }

  private async confirmRemoteResult(
    groupId: string, pr: PrRef, action: 'merge' | 'close', source: 'native' | 'ai' | 'external',
    documentId?: string, expectedHeadSha?: string,
  ): Promise<'merged' | 'closed' | null> {
    const item = this.group?.groupId === groupId
      ? this.group.items.find((x) => repoKeyOf(x.pr) === repoKeyOf(pr) && x.pr.number === pr.number)
      : undefined
    if (!item || (source !== 'native' && item.outcome !== 'pending')) return null
    const remote = await this.reviewGateway.read(item.pr)
    const current = this.group?.groupId === groupId
      ? this.group.items.find((x) => repoKeyOf(x.pr) === repoKeyOf(pr) && x.pr.number === pr.number)
      : undefined
    if (!current) return null
    if (expectedHeadSha && remote.headSha.toLowerCase() !== expectedHeadSha.toLowerCase()) return null
    const outcome = remote.state === 'merged' ? 'merged' : remote.state === 'closed' ? 'closed' : null
    if (!outcome || (action === 'merge' && outcome !== 'merged') || (action === 'close' && outcome !== 'closed')) return null
    if (current.outcome !== 'pending' && (source !== 'native' || current.outcome !== outcome)) return null
    if (current.outcome === 'pending') {
      this.replaceGroupItem({ ...current, outcome })
      this.analytics?.track('pr_panel_group_item_completed', {
        completion_source: source, completion_outcome: outcome,
        remaining_pr_count: this.group?.items.filter((x) => x.outcome === 'pending').length ?? 0,
      })
    }
    // Only native replays are deduplicated: an AI confirmation for the same tab must not hide a later native result.
    const feedbackKey = source === 'native' && documentId ? `${groupId}/${repoKeyOf(pr)}#${pr.number}/${documentId}/${action}` : null
    if (!feedbackKey || !this.nativeFeedbackSent.has(feedbackKey)) {
      if (feedbackKey) this.nativeFeedbackSent.add(feedbackKey)
      this.broadcast({ type: 'reviewItemResult', groupId, pr: current.pr, outcome, source, ...(documentId ? { documentId } : {}) })
    }
    return outcome
  }

  private async confirmNativeResult(groupId: string, pr: PrRef, action: 'merge' | 'close', documentId: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.group?.groupId !== groupId) return
      const session = this.sessions.get(documentId)?.session
      if (!session || repoKeyOf(session.pr) !== repoKeyOf(pr) || session.pr.number !== pr.number) return
      try {
        if (await this.confirmRemoteResult(groupId, pr, action, 'native', documentId)) return
      } catch { /* GitHub can briefly lag the page; retry this bounded confirmation. */ }
      if (attempt < 2) await new Promise<void>((resolve) => setTimeout(resolve, (attempt + 1) * 500))
    }
  }

  private groupBody(): Extract<HubFrameBody, { type: 'group' }> {
    return { type: 'group', group: this.group, preparation: this.preparation }
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
    const observed = new Map<number, NonNullable<ReturnType<PrStatusStore['get']>>>()
    for (const item of this.store.listLatestCompleted(key)) {
      const value = this.statuses?.get(key, item.prNumber)
      if (!value) continue
      if (value.headSha) heads.set(item.prNumber, value.headSha)
      observed.set(item.prNumber, value)
    }
    return {
      type: 'reviews',
      repoKey: key,
      items: this.store.listLatestCompleted(key, heads, new Map([...observed].map(([number, value]) => [number, value.state])))
        .map((item) => ({
          ...item,
          ...effectiveReadiness({
            prState: item.prState,
            readiness: observed.get(item.prNumber)?.readiness ?? 'unknown',
            readinessReason: observed.get(item.prNumber)?.readinessReason,
          }),
          ...(observed.get(item.prNumber)?.authorLogin ? { authorLogin: observed.get(item.prNumber)?.authorLogin } : {}),
        })),
      ...(inReplyTo ? { inReplyTo } : {}),
    }
  }

  /** Broadcast one changed repository through the existing reviews frame. */
  refreshReviews(repoKey: string): void {
    this.broadcast(this.reviewsBody(repoKey))
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
