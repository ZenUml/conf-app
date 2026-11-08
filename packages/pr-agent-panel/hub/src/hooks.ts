/**
 * Lifecycle hooks from the agent plugin. Structure adapted from TemPad Dev's
 * ClientHooks (MIT, Baidu EFE team; see THIRD_PARTY_NOTICES.md): sessions are
 * keyed by host kind + session id and capped. Ours also delivers queued panel
 * messages through the hook output.
 *
 * Every call answers synchronously: a hook has a 2 s budget and must never
 * wait for anything.
 */
import {
  formatPanelMessagesForAgent,
  type ClientHookRequest,
  type ClientHookResponse,
  type DeliveryChannel,
  type HookEvent,
  type PanelMessage,
} from '@zenuml/pr-panel-shared'
import type { MessagePredicate } from './message-queue'

export const MAX_HOOK_SESSIONS = 256
/** A session with no hook event for this long no longer counts as "in a turn". */
export const TURN_IDLE_EXPIRY_MS = 30 * 60_000

export interface HookSession {
  kind: ClientHookRequest['kind']
  sessionId: string
  /** Between UserPromptSubmit/PreToolUse/PostToolUse and Stop. */
  inTurn: boolean
  ended: boolean
  boundTaskIds: Set<string>
  lastEventAt: number
}

/** What the hooks need from the runtime; kept narrow so hooks stay testable. */
export interface HookPort {
  now(): number
  isWorkingTask(taskId: string): boolean
  activePr(): { repoKey: string; prNumber: number } | null
  /** Marks matching pending messages delivered on `channel` and returns them. */
  deliver(predicate: MessagePredicate, channel: DeliveryChannel): PanelMessage[]
  /** Notices (e.g. "the user stopped task X") owed to sessions bound to these tasks; consumed on read. */
  takeNotices(taskIds: ReadonlySet<string>): string[]
  /** A bound session finished a turn (Stop without a block). */
  turnEnded(taskIds: ReadonlySet<string>): void
}

function scope(kind: string, sessionId: string): string {
  return JSON.stringify([kind, sessionId])
}

export class ClientHooks {
  private readonly sessions = new Map<string, HookSession>()

  constructor(private readonly port: HookPort) {}

  /** True when any live session is inside a turn, i.e. a hook channel will run soon. */
  anyInTurn(): boolean {
    const now = this.port.now()
    for (const s of this.sessions.values()) {
      if (s.inTurn && !s.ended && now - s.lastEventAt < TURN_IDLE_EXPIRY_MS) return true
    }
    return false
  }

  session(kind: ClientHookRequest['kind'], sessionId: string): HookSession | undefined {
    return this.sessions.get(scope(kind, sessionId))
  }

  get size(): number {
    return this.sessions.size
  }

  handle(request: ClientHookRequest): ClientHookResponse {
    const session = this.upsert(request)
    session.lastEventAt = this.port.now()
    if (request.taskId && request.event === 'PostToolUse') session.boundTaskIds.add(request.taskId)

    switch (request.event) {
      case 'SessionEnd':
        session.inTurn = false
        session.ended = true
        return { deliveredMessageIds: [] }
      case 'SessionStart':
        session.ended = false
        return { deliveredMessageIds: [] }
      case 'Stop':
        return this.onStop(session, request.stopHookActive === true)
      case 'UserPromptSubmit':
      case 'PreToolUse':
      case 'PostToolUse':
        session.ended = false
        session.inTurn = true
        return this.inject(session, request.event, request.event === 'UserPromptSubmit' ? 'prompt_context' : 'hook_context')
    }
  }

  private upsert(request: ClientHookRequest): HookSession {
    const key = scope(request.kind, request.sessionId)
    const existing = this.sessions.get(key)
    if (existing) return existing
    if (this.sessions.size >= MAX_HOOK_SESSIONS) {
      // Evict an ended session first, else the least recently seen one.
      const entries = [...this.sessions]
      const victim =
        entries.find(([, s]) => s.ended) ?? entries.sort(([, a], [, b]) => a.lastEventAt - b.lastEventAt)[0]
      if (victim) this.sessions.delete(victim[0])
    }
    const session: HookSession = {
      kind: request.kind,
      sessionId: request.sessionId,
      inTurn: false,
      ended: false,
      boundTaskIds: new Set(),
      lastEventAt: this.port.now(),
    }
    this.sessions.set(key, session)
    return session
  }

  /**
   * Messages owed to this session: those bound to a task the session started,
   * plus, while it has no working task, unbound messages for the active PR.
   */
  predicateFor(session: HookSession): MessagePredicate {
    const hasWorkingTask = [...session.boundTaskIds].some((id) => this.port.isWorkingTask(id))
    const active = hasWorkingTask ? null : this.port.activePr()
    return (m) => {
      if (m.taskId) return session.boundTaskIds.has(m.taskId)
      return active !== null && m.repoKey === active.repoKey && m.prNumber === active.prNumber
    }
  }

  private inject(session: HookSession, event: HookEvent, channel: DeliveryChannel): ClientHookResponse {
    const notices = this.port.takeNotices(session.boundTaskIds)
    const messages = this.port.deliver(this.predicateFor(session), channel)
    if (!messages.length && !notices.length) return { deliveredMessageIds: [] }
    const parts = [...notices]
    if (messages.length) parts.push(formatPanelMessagesForAgent(messages))
    return {
      output: { hookSpecificOutput: { hookEventName: event, additionalContext: parts.join('\n\n') } },
      deliveredMessageIds: messages.map((m) => m.messageId),
      channel: messages.length ? channel : undefined,
    }
  }

  private onStop(session: HookSession, stopHookActive: boolean): ClientHookResponse {
    session.inTurn = false
    // Claude Code already continued once because of a Stop hook: never block again this turn.
    if (stopHookActive) {
      this.port.turnEnded(session.boundTaskIds)
      return { deliveredMessageIds: [] }
    }
    const messages = this.port.deliver(this.predicateFor(session), 'stop_block')
    if (!messages.length) {
      this.port.turnEnded(session.boundTaskIds)
      return { deliveredMessageIds: [] }
    }
    session.inTurn = true
    return {
      output: { decision: 'block', reason: formatPanelMessagesForAgent(messages) },
      deliveredMessageIds: messages.map((m) => m.messageId),
      channel: 'stop_block',
    }
  }
}
