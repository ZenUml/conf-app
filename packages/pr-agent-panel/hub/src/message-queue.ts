import type { DeliveryChannel, PanelMessage } from '@zenuml/pr-panel-shared'

export type MessagePredicate = (message: PanelMessage) => boolean

interface Waiter {
  predicate: MessagePredicate
  resolve: (messages: PanelMessage[]) => void
  timer: ReturnType<typeof setTimeout>
}

/** Per PR, keep at most this many messages; delivered ones are dropped first. */
export const MAX_MESSAGES_PER_PR = 200

/**
 * Panel messages per `repoKey#prNumber`, with delivery marking and long-poll
 * waiters. Delivery is marked synchronously wherever it happens, so two
 * channels can never hand out the same message.
 */
export class MessageQueue {
  private readonly byPr = new Map<string, PanelMessage[]>()
  private readonly waiters = new Set<Waiter>()

  constructor(
    private readonly onDelivered: (messages: PanelMessage[], channel: DeliveryChannel) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  static key(repoKey: string, prNumber: number): string {
    return `${repoKey.toLowerCase()}#${prNumber}`
  }

  /**
   * Store a message. Returns whether a long-poll waiter will take it; call
   * `dispatchWaiters()` afterwards to hand it over (the caller first replies
   * `messageQueued`, so the panel sees queued before delivered).
   */
  enqueue(message: PanelMessage): { waiterMatched: boolean } {
    const key = MessageQueue.key(message.repoKey, message.prNumber)
    const list = this.byPr.get(key) ?? []
    list.push(message)
    while (list.length > MAX_MESSAGES_PER_PR) {
      const deliveredIndex = list.findIndex((m) => m.deliveredAt !== undefined)
      list.splice(deliveredIndex >= 0 ? deliveredIndex : 0, 1)
    }
    this.byPr.set(key, list)
    return { waiterMatched: [...this.waiters].some((w) => w.predicate(message)) }
  }

  /** Give pending messages to the waiters that match them, oldest waiter first. */
  dispatchWaiters(): void {
    for (const waiter of [...this.waiters]) {
      const messages = this.deliver(waiter.predicate, 'tool_poll')
      if (messages.length) this.settle(waiter, messages)
    }
  }

  /** Undelivered messages matching `predicate`, oldest first. */
  pending(predicate: MessagePredicate = () => true): PanelMessage[] {
    return this.all().filter((m) => m.deliveredAt === undefined && predicate(m))
  }

  /** Every message (delivered or not) matching `predicate`, oldest first. */
  all(predicate: MessagePredicate = () => true): PanelMessage[] {
    return [...this.byPr.values()]
      .flat()
      .filter(predicate)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Mark every pending message matching `predicate` delivered on `channel`; returns them. */
  deliver(predicate: MessagePredicate, channel: DeliveryChannel): PanelMessage[] {
    const ids = new Set(this.pending(predicate).map((m) => m.messageId))
    return this.markDelivered(ids, channel)
  }

  markDelivered(ids: ReadonlySet<string>, channel: DeliveryChannel): PanelMessage[] {
    if (!ids.size) return []
    const at = this.now()
    const changed: PanelMessage[] = []
    for (const [key, list] of this.byPr) {
      this.byPr.set(
        key,
        list.map((m) => {
          if (!ids.has(m.messageId) || m.deliveredAt !== undefined) return m
          const next: PanelMessage = { ...m, deliveredAt: at, channel }
          changed.push(next)
          return next
        }),
      )
    }
    changed.sort((a, b) => a.createdAt - b.createdAt)
    if (changed.length) this.onDelivered(changed, channel)
    return changed
  }

  /**
   * Resolve with matching messages (marked delivered via `tool_poll`) as soon
   * as any are pending, or with `[]` after `timeoutMs`.
   */
  waitFor(predicate: MessagePredicate, timeoutMs: number, signal?: AbortSignal): Promise<PanelMessage[]> {
    const ready = this.deliver(predicate, 'tool_poll')
    if (ready.length || signal?.aborted) return Promise.resolve(ready)
    return new Promise((resolve) => {
      const waiter: Waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => this.settle(waiter, []), timeoutMs),
      }
      this.waiters.add(waiter)
      signal?.addEventListener('abort', () => this.settle(waiter, []), { once: true })
    })
  }

  get waiterCount(): number {
    return this.waiters.size
  }

  /** Resolve every waiter with `[]` (shutdown, consumer gone). */
  cancelWaiters(): void {
    for (const waiter of [...this.waiters]) this.settle(waiter, [])
  }

  private settle(waiter: Waiter, messages: PanelMessage[]): void {
    if (!this.waiters.delete(waiter)) return
    clearTimeout(waiter.timer)
    waiter.resolve(messages)
  }
}
