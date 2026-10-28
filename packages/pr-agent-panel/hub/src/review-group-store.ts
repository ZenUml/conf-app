import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { ReviewGroupSchema, type ReviewGroup } from '@zenuml/pr-panel-shared'
import { PRIVATE_FILE_MODE } from './runtime-paths'

/** One latest request, atomically replaced. Earlier groups are not a queue. */
export class ReviewGroupStore {
  private readonly file: string
  private group: ReviewGroup | null

  constructor(storeDir: string) {
    mkdirSync(storeDir, { recursive: true, mode: 0o700 })
    this.file = join(storeDir, 'review-group.json')
    this.group = this.load()
  }

  get(): ReviewGroup | null { return this.group }

  put(group: ReviewGroup): void {
    const valid = ReviewGroupSchema.parse(group)
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify(valid), { mode: PRIVATE_FILE_MODE })
    renameSync(tmp, this.file)
    this.group = valid
  }

  private load(): ReviewGroup | null {
    if (!existsSync(this.file)) return null
    try {
      const parsed = ReviewGroupSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')))
      return parsed.success ? parsed.data : null
    } catch { return null }
  }
}
