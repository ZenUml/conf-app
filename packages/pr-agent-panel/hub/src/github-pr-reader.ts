import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { repoKeyOf, ShaSchema, type PrRef } from '@zenuml/pr-panel-shared'
import type { ObservedPr } from './pr-status-store'

const execFile = promisify(execFileCallback)
const BATCH_SIZE = 20
const GitHubPrSchema = z.object({
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  headRefOid: ShaSchema.nullable(),
})

export interface GitHubReadResult {
  observations: Array<{ ref: PrRef; observed: ObservedPr }>
  failed: number
}

export type QueryGraphql = (query: string) => Promise<unknown>

/** Use the user's existing gh login. No token is read, copied, or persisted. */
export const queryGraphqlWithGh: QueryGraphql = async (query) => {
  const { stdout } = await execFile('gh', ['api', 'graphql', '--hostname', 'github.com', '-f', `query=${query}`], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  })
  return JSON.parse(stdout)
}

function validRef(ref: PrRef): boolean {
  return ref.host.toLowerCase() === 'github.com'
    && /^[A-Za-z0-9_.-]+$/.test(ref.owner)
    && /^[A-Za-z0-9_.-]+$/.test(ref.repo)
    && Number.isSafeInteger(ref.number) && ref.number > 0
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Query only distinct PRs with saved completed reviews; partial failures never imply closure. */
export async function readSavedPrStatuses(refs: PrRef[], query: QueryGraphql = queryGraphqlWithGh): Promise<GitHubReadResult> {
  const observations: GitHubReadResult['observations'] = []
  let failed = 0
  const groups = new Map<string, PrRef[]>()
  for (const ref of refs) {
    if (!validRef(ref)) { failed++; continue }
    const key = repoKeyOf(ref)
    const group = groups.get(key) ?? []
    if (!group.some((item) => item.number === ref.number)) group.push(ref)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    for (const batch of chunks(group, BATCH_SIZE)) {
      const { owner, repo } = batch[0]
      const fields = batch.map((ref, i) => `p${i}: pullRequest(number: ${ref.number}) { state isDraft headRefOid }`).join(' ')
      const graphql = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ${fields} } }`
      try {
        const response = await query(graphql) as { data?: { repository?: Record<string, unknown> | null } }
        const repository = response?.data?.repository
        for (let i = 0; i < batch.length; i++) {
          const parsed = GitHubPrSchema.safeParse(repository?.[`p${i}`])
          if (!parsed.success) { failed++; continue }
          const pr = parsed.data
          observations.push({
            ref: batch[i],
            observed: {
              state: pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'open',
              ...(pr.headRefOid ? { headSha: pr.headRefOid } : {}),
            },
          })
        }
      } catch {
        failed += batch.length
      }
    }
  }
  return { observations, failed }
}
