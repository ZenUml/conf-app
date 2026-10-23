import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ReviewRunSchema, toReviewSummary, type ReviewRun, type ReviewSummary } from '@zenuml/pr-panel-shared'
import { PRIVATE_FILE_MODE } from './runtime-paths'
import { createLogger } from './log'

const log = createLogger('store')
const FileSchema = z.array(ReviewRunSchema)

/** At most this many runs per repository are kept; the oldest go first. */
export const MAX_RUNS_PER_REPO = 500

/**
 * Review runs as JSON files, one per repository: `<storeDir>/reviews/<encoded repoKey>.json`.
 * Writes are atomic (tmp file + rename) so a crash never leaves half a file.
 */
export class ReviewStore {
  private readonly dir: string
  private readonly cache = new Map<string, ReviewRun[]>()

  constructor(storeDir: string) {
    this.dir = join(storeDir, 'reviews')
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
  }

  fileFor(repoKey: string): string {
    return join(this.dir, `${encodeURIComponent(repoKey.toLowerCase())}.json`)
  }

  private load(repoKey: string): ReviewRun[] {
    const key = repoKey.toLowerCase()
    const cached = this.cache.get(key)
    if (cached) return cached
    const file = this.fileFor(key)
    let runs: ReviewRun[] = []
    if (existsSync(file)) {
      try {
        const parsed = FileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
        if (parsed.success) runs = parsed.data
        else log.warn('Ignoring malformed review file', file)
      } catch (error) {
        log.warn('Could not read review file', error)
      }
    }
    this.cache.set(key, runs)
    return runs
  }

  private save(repoKey: string, runs: ReviewRun[]): void {
    const file = this.fileFor(repoKey)
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify(runs), { mode: PRIVATE_FILE_MODE })
    renameSync(tmp, file)
  }

  /** Insert or replace by `runId`. */
  upsert(run: ReviewRun): void {
    const valid = ReviewRunSchema.parse(run)
    const key = valid.repoKey.toLowerCase()
    const runs = [...this.load(key)]
    const index = runs.findIndex((r) => r.runId === valid.runId)
    if (index >= 0) runs[index] = valid
    else runs.push(valid)
    const trimmed = runs.length > MAX_RUNS_PER_REPO ? runs.slice(runs.length - MAX_RUNS_PER_REPO) : runs
    this.save(key, trimmed)
    this.cache.set(key, trimmed)
  }

  /** Newest first; optionally one PR. */
  history(repoKey: string, prNumber?: number, limit = 10): ReviewRun[] {
    return this.load(repoKey)
      .filter((r) => prNumber === undefined || r.pr.number === prNumber)
      .sort((a, b) => endTime(b) - endTime(a))
      .slice(0, limit)
  }

  /**
   * Latest completed run per PR, newest first. `current` is the PR head the
   * page shows: a map `prNumber -> headSha` marks only those PRs, a bare SHA
   * is compared with every row. A PR with no known head is never stale.
   */
  listLatestCompleted(repoKey: string, current?: string | ReadonlyMap<number, string>): ReviewSummary[] {
    const latest = new Map<number, ReviewRun>()
    for (const run of this.load(repoKey)) {
      if (run.status !== 'completed') continue
      const prior = latest.get(run.pr.number)
      if (!prior || endTime(run) >= endTime(prior)) latest.set(run.pr.number, run)
    }
    return [...latest.values()]
      .sort((a, b) => endTime(b) - endTime(a))
      .map((run) => toReviewSummary(run, typeof current === 'string' ? current : current?.get(run.pr.number)))
  }

  /** Drop the in-memory cache (tests: prove a reload reads the file). */
  clearCache(): void {
    this.cache.clear()
  }
}

function endTime(run: ReviewRun): number {
  return run.completedAt ?? run.startedAt
}
