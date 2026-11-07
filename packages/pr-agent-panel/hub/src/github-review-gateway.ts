import { execFile as execFileCallback } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { ShaSchema, type PrRef } from '@zenuml/pr-panel-shared'
import { PRIVATE_FILE_MODE } from './runtime-paths'

const execFile = promisify(execFileCallback)
const RemotePrSchema = z.object({
  state: z.enum(['open', 'closed']),
  merged: z.boolean(),
  head: z.object({ sha: ShaSchema }),
  body: z.string().nullable(),
})

export interface RemotePr {
  state: 'open' | 'closed' | 'merged'
  headSha: string
  body: string
}

export interface ReviewGateway {
  read(pr: PrRef): Promise<RemotePr>
  readCi?(pr: PrRef): Promise<'success' | 'failure' | 'pending' | 'unknown'>
  writeMaterials(pr: PrRef, expectedHeadSha: string, markdown: string, stillCurrent: () => boolean): Promise<void>
}

const START = '<!-- zenuml-pr-review:start -->'
const END = '<!-- zenuml-pr-review:end -->'

export function withReviewMaterials(original: string, markdown: string): string {
  const start = original.indexOf(START)
  const end = original.indexOf(END)
  const after = start >= 0 && end > start ? original.slice(end + END.length) : ''
  const body = start >= 0 && end > start
    ? original.slice(0, start) + (after.startsWith('\n\n') ? after.slice(2) : after)
    : original
  return `${START}\n${markdown.trim()}\n${END}\n\n${body}`
}

function validPr(pr: PrRef): void {
  if (pr.host.toLowerCase() !== 'github.com' || !/^[A-Za-z0-9_.-]+$/.test(pr.owner) || !/^[A-Za-z0-9_.-]+$/.test(pr.repo)) {
    throw new Error('Only github.com pull requests with valid repository names are supported.')
  }
}

export interface RollupCheck { name?: string; context?: string; workflowName?: string; state?: string; status?: string; conclusion?: string }

const FAILED = ['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED']
const RUNNING = ['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED']
const PASSED = ['SUCCESS', 'NEUTRAL', 'SKIPPED']

/**
 * CI verdict for the list badge. CI here cancels the duplicate `push` run beside a green `pull_request`
 * run of the same check, so a cancelled check is ignored only when the same check also passed;
 * any other cancellation leaves the verdict unknown, never success.
 */
export function ciFromRollup(checks: RollupCheck[]): 'success' | 'failure' | 'pending' | 'unknown' {
  if (!checks.length) return 'unknown'
  const outcome = (check: RollupCheck) => (check.conclusion ?? check.state ?? '').toUpperCase()
  const key = (check: RollupCheck) => `${check.workflowName ?? ''}/${check.name ?? check.context ?? ''}`
  if (checks.some((check) => FAILED.includes(outcome(check)))) return 'failure'
  if (checks.some((check) => RUNNING.includes((check.status ?? check.state ?? '').toUpperCase()))) return 'pending'
  const passed = new Set(checks.filter((check) => PASSED.includes(outcome(check))).map(key))
  const decisive = checks.filter((check) => outcome(check) !== 'CANCELLED' || !passed.has(key(check)))
  return decisive.length && decisive.every((check) => PASSED.includes(outcome(check))) ? 'success' : 'unknown'
}

export class GhReviewGateway implements ReviewGateway {
  async readCi(pr: PrRef): Promise<'success' | 'failure' | 'pending' | 'unknown'> {
    validPr(pr)
    const { stdout } = await execFile('gh', ['pr', 'view', String(pr.number), '--repo', `${pr.owner}/${pr.repo}`, '--json', 'statusCheckRollup'], {
      timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
    })
    const raw = JSON.parse(stdout) as { statusCheckRollup?: RollupCheck[] }
    return ciFromRollup(raw.statusCheckRollup ?? [])
  }

  async read(pr: PrRef): Promise<RemotePr> {
    validPr(pr)
    const { stdout } = await execFile('gh', ['api', `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`], {
      timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
    })
    const parsed = RemotePrSchema.parse(JSON.parse(stdout))
    return {
      state: parsed.merged ? 'merged' : parsed.state,
      headSha: parsed.head.sha,
      body: parsed.body ?? '',
    }
  }

  async writeMaterials(pr: PrRef, expectedHeadSha: string, markdown: string, stillCurrent: () => boolean): Promise<void> {
    const remote = await this.read(pr)
    if (remote.state !== 'open') throw new Error(`PR #${pr.number} is no longer open.`)
    if (remote.headSha.toLowerCase() !== expectedHeadSha.toLowerCase()) throw new Error(`PR #${pr.number} head changed during preparation.`)
    if (!stillCurrent()) throw new Error('A newer review request replaced this preparation.')
    const nextBody = withReviewMaterials(remote.body, markdown)
    if (nextBody === remote.body) return
    const dir = mkdtempSync(join(tmpdir(), 'pr-panel-materials-'))
    try {
      const file = join(dir, 'body.json')
      writeFileSync(file, JSON.stringify({ body: nextBody }), { mode: PRIVATE_FILE_MODE })
      if (!stillCurrent()) throw new Error('A newer review request replaced this preparation.')
      await execFile('gh', ['api', '--method', 'PATCH', `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`, '--input', file], {
        timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
