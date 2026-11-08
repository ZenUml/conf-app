import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { AnalyticsEventName } from '../../../../src/utils/analytics/catalog'
import { PRIVATE_FILE_MODE } from './runtime-paths'
import { createLogger } from './log'

const log = createLogger('analytics')

export type PrPanelEventName = Extract<AnalyticsEventName, `pr_panel_${string}`>
export type AnalyticsProps = Record<string, string | number | boolean | undefined>

/**
 * The only property keys that ever leave this machine: the extension's
 * TelemetryFrame props plus the Hub's own task/delivery counters. No repo,
 * PR number, title, SHA or text can pass.
 */
export const ALLOWED_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  'review_count',
  'scope_mode',
  'scope_outcome',
  'visible_review_count',
  'excluded_review_count',
  'deleted_run_count',
  'delete_outcome',
  'sync_outcome',
  'checked_pr_count',
  'changed_pr_count',
  'failed_pr_count',
  'ready_pr_count',
  'blocked_pr_count',
  'unknown_pr_count',
  'p0_count',
  'row_index',
  'is_stale',
  'panel_state',
  'connect_ms',
  'hub_disconnect_reason',
  'message_length_bucket',
  'preference_key',
  'task_kind',
  'agent_kind',
  'resumed',
  'task_outcome',
  'duration_ms',
  'finding_count',
  'turn_count',
  'delivery_channel',
  'requested_pr_count',
  'prepared_pr_count',
  'group_outcome',
  'completion_source',
  'completion_outcome',
  'remaining_pr_count',
])

export const MIXPANEL_TRACK_URL = 'https://api.mixpanel.com/track'

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<unknown>

export interface AnalyticsOptions {
  token?: string
  /** File holding this machine's random distinct_id (created 0600 on first use). */
  idPath: string
  fetchImpl?: FetchLike
  now?: () => number
}

export function filterProps(props: AnalyticsProps): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!ALLOWED_PROPERTY_KEYS.has(key)) continue
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      out[key] = value
    }
  }
  return out
}

/** Optional Mixpanel emitter; a no-op unless a project token is configured. Never throws. */
export class Analytics {
  private readonly token: string | undefined
  private readonly idPath: string
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private distinctId: string | undefined
  private readonly inFlight = new Set<Promise<void>>()

  constructor(options: AnalyticsOptions) {
    this.token = options.token || undefined
    this.idPath = options.idPath
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init))
    this.now = options.now ?? Date.now
  }

  get enabled(): boolean {
    return this.token !== undefined
  }

  track(event: PrPanelEventName, props: AnalyticsProps = {}): void {
    if (!this.token) return
    try {
      const body = [
        {
          event,
          properties: {
            ...filterProps(props),
            token: this.token,
            distinct_id: this.getDistinctId(),
            time: Math.floor(this.now() / 1000),
            feature_area: 'pr_agent_panel',
            surface: 'github_pr',
          },
        },
      ]
      const send = this.fetchImpl(MIXPANEL_TRACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
        body: JSON.stringify(body),
      })
        .then(() => undefined)
        .catch((error: unknown) => log.debug('Mixpanel send failed', error))
      const tracked = send.finally(() => this.inFlight.delete(tracked))
      this.inFlight.add(tracked)
    } catch (error) {
      log.debug('Mixpanel event dropped', error)
    }
  }

  /** Wait for queued sends (tests, shutdown). */
  async flush(): Promise<void> {
    await Promise.all([...this.inFlight])
  }

  private getDistinctId(): string {
    if (this.distinctId) return this.distinctId
    try {
      if (existsSync(this.idPath)) {
        const stored = readFileSync(this.idPath, 'utf8').trim()
        if (/^[0-9a-f-]{36}$/i.test(stored)) return (this.distinctId = stored)
      }
      const id = randomUUID()
      writeFileSync(this.idPath, id, { mode: PRIVATE_FILE_MODE })
      return (this.distinctId = id)
    } catch {
      return (this.distinctId = randomUUID())
    }
  }
}
