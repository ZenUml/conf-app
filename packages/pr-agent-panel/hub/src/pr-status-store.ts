import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { PrStateSchema, ShaSchema, type PrState } from '@zenuml/pr-panel-shared'
import { PRIVATE_FILE_MODE } from './runtime-paths'
import { createLogger } from './log'

const log = createLogger('pr-status-store')
const ObservedSchema = z.object({ state: PrStateSchema, headSha: ShaSchema.optional() })
const FileSchema = z.record(z.string(), ObservedSchema)
export type ObservedPr = { state: PrState; headSha?: string }

function key(repoKey: string, prNumber: number): string {
  return `${repoKey.toLowerCase()}#${prNumber}`
}

/** Current GitHub observations live apart from immutable review results. */
export class PrStatusStore {
  private readonly file: string
  private readonly entries: Record<string, ObservedPr>

  constructor(storeDir: string) {
    this.file = join(storeDir, 'pr-status.json')
    this.entries = {}
    if (!existsSync(this.file)) return
    try {
      const parsed = FileSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')))
      if (parsed.success) Object.assign(this.entries, parsed.data)
      else log.warn('Ignoring malformed PR status file', this.file)
    } catch (error) {
      log.warn('Could not read PR status file', error)
    }
  }

  get(repoKey: string, prNumber: number): ObservedPr | undefined {
    return this.entries[key(repoKey, prNumber)]
  }

  /** Return true only when the observation changed. A missing head does not erase a known head. */
  set(repoKey: string, prNumber: number, observed: ObservedPr): boolean {
    const id = key(repoKey, prNumber)
    const prior = this.entries[id]
    const next = { state: observed.state, ...(observed.headSha ?? prior?.headSha ? { headSha: observed.headSha ?? prior?.headSha } : {}) }
    if (prior?.state === next.state && prior.headSha === next.headSha) return false
    const previous = this.entries[id]
    this.entries[id] = next
    try {
      this.save()
    } catch (error) {
      if (previous) this.entries[id] = previous
      else delete this.entries[id]
      throw error
    }
    return true
  }

  delete(repoKey: string, prNumber: number): void {
    const id = key(repoKey, prNumber)
    if (!(id in this.entries)) return
    const previous = this.entries[id]
    delete this.entries[id]
    try {
      this.save()
    } catch (error) {
      this.entries[id] = previous
      throw error
    }
  }

  private save(): void {
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify(this.entries), { mode: PRIVATE_FILE_MODE })
    renameSync(tmp, this.file)
  }
}
