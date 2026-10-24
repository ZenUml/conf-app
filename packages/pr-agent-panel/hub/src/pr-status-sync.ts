import type { Analytics } from './analytics'
import { repoKeyOf } from '@zenuml/pr-panel-shared'
import { createLogger } from './log'
import type { ReviewStore } from './review-store'
import type { PrStatusStore } from './pr-status-store'
import { readSavedPrStatuses, type GitHubReadResult } from './github-pr-reader'

const log = createLogger('pr-status-sync')
const POLL_MS = 5 * 60_000
const MIN_REFRESH_MS = 30_000
const MAX_FAILURE_BACKOFF_MS = 30 * 60_000

export interface PrStatusSyncOptions {
  reviews: ReviewStore
  statuses: PrStatusStore
  analytics?: Analytics
  onChanged: (repoKey: string) => void
  read?: typeof readSavedPrStatuses
  now?: () => number
}

/** One serialized refresh loop. The Hub's existing idle lifetime remains unchanged. */
export class PrStatusSync {
  private readonly read: typeof readSavedPrStatuses
  private readonly now: () => number
  private periodic: ReturnType<typeof setInterval> | undefined
  private pending: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<void> | undefined
  private lastStarted = 0
  private backoffUntil = 0
  private failureStreak = 0
  private rerun = false
  private stopped = false

  constructor(private readonly options: PrStatusSyncOptions) {
    this.read = options.read ?? readSavedPrStatuses
    this.now = options.now ?? Date.now
  }

  start(): void {
    if (this.periodic || this.stopped) return
    this.periodic = setInterval(() => this.request(), POLL_MS)
    this.periodic.unref()
    this.request()
  }

  stop(): void {
    this.stopped = true
    if (this.periodic) clearInterval(this.periodic)
    if (this.pending) clearTimeout(this.pending)
    this.periodic = undefined
    this.pending = undefined
  }

  /** Coalesce reconnects, list requests, and newly published reviews. */
  request(): void {
    if (this.stopped) return
    if (this.inFlight) { this.rerun = true; return }
    if (this.pending) return
    const delay = Math.max(0, this.lastStarted + MIN_REFRESH_MS - this.now(), this.backoffUntil - this.now())
    this.pending = setTimeout(() => {
      this.pending = undefined
      this.inFlight = this.refresh().catch((error: unknown) => {
        log.warn('Saved PR status refresh failed', error)
      }).finally(() => {
        this.inFlight = undefined
        if (this.rerun) { this.rerun = false; this.request() }
      })
    }, delay)
    this.pending.unref()
  }

  /** Explicitly await one cycle in tests and diagnostics. */
  async refresh(): Promise<void> {
    if (this.stopped) return
    this.lastStarted = this.now()
    const refs = this.options.reviews.listReviewedPrRefs()
    if (refs.length === 0) return
    let result: GitHubReadResult
    try {
      result = await this.read(refs)
    } catch (error) {
      log.warn('Could not refresh saved PR statuses', error)
      result = { observations: [], failed: refs.length }
    }
    const changedRepos = new Set<string>()
    let changed = 0
    for (const { ref, observed } of result.observations) {
      const repoKey = `${ref.host}/${ref.owner}/${ref.repo}`.toLowerCase()
      // A review may have been deleted while GitHub answered; never resurrect it.
      if (!this.options.reviews.listLatestCompleted(repoKey).some((run) => run.prNumber === ref.number)) continue
      try {
        if (this.options.statuses.set(repoKey, ref.number, observed)) {
          changed++
          changedRepos.add(repoKey)
        }
      } catch (error) {
        result.failed++
        log.warn('Could not save PR status', error)
      }
    }
    for (const repoKey of changedRepos) this.options.onChanged(repoKey)
    const failed = result.failed
    const counts = { ready: 0, blocked: 0, unknown: 0 }
    for (const ref of refs) counts[this.options.statuses.get(repoKeyOf(ref), ref.number)?.readiness ?? 'unknown']++
    const repoKeys = new Set(refs.map(repoKeyOf))
    const p0Count = [...repoKeys].reduce((sum, key) =>
      sum + this.options.reviews.listLatestCompleted(key).filter((item) => item.priority === 'P0').length, 0)
    if (failed > 0) {
      this.failureStreak++
      const delay = Math.min(MAX_FAILURE_BACKOFF_MS, POLL_MS * 2 ** Math.min(this.failureStreak - 1, 3))
      this.backoffUntil = this.now() + delay
    } else {
      this.failureStreak = 0
      this.backoffUntil = 0
    }
    this.options.analytics?.track('pr_panel_pr_status_sync_completed', {
      sync_outcome: failed ? (result.observations.length ? 'partial' : 'failed') : changed ? 'updated' : 'unchanged',
      checked_pr_count: refs.length,
      changed_pr_count: changed,
      failed_pr_count: failed,
      ready_pr_count: counts.ready,
      blocked_pr_count: counts.blocked,
      unknown_pr_count: counts.unknown,
      p0_count: p0Count,
    })
  }
}
