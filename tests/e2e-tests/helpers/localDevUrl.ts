import { execFileSync } from 'node:child_process'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../../..')
const baseURL = process.env.LOCAL_DEV_URL || execFileSync(
  'pnpm',
  ['--silent', 'dev:url'],
  { cwd: repoRoot, encoding: 'utf8' },
).trim()

export function localDevUrl(path: string): string {
  return new URL(path, `${baseURL}/`).toString()
}
