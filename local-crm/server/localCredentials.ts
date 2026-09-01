import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const CREDENTIAL_KEYS = [
  'FORGE_EMAIL',
  'FORGE_API_TOKEN',
  'JSM_EMAIL',
  'JSM_API_TOKEN'
] as const

type CredentialKey = typeof CREDENTIAL_KEYS[number]
type MutableEnv = Record<string, string | undefined>

interface InstallCredentialOptions {
  repoRoot: string
  env?: MutableEnv
  findMainCheckout?: (repoRoot: string) => string | null
  fileExists?: (path: string) => boolean
  readTextFile?: (path: string) => string
}

interface InstallCredentialResult {
  loaded: CredentialKey[]
  filesRead: string[]
}

function parseDotEnv(content: string): Partial<Record<CredentialKey, string>> {
  const parsed: Partial<Record<CredentialKey, string>> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const rawKey = line.slice(0, separator).trim().replace(/^export\s+/, '')
    if (!CREDENTIAL_KEYS.includes(rawKey as CredentialKey)) continue
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (value) parsed[rawKey as CredentialKey] = value
  }
  return parsed
}

function readGitCommonDirectory(repoRoot: string): string {
  return execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: repoRoot, encoding: 'utf8' }
  )
}

export function findMainCheckout(
  repoRoot: string,
  gitCommonDirectory: (repoRoot: string) => string = readGitCommonDirectory
): string | null {
  try {
    const commonDirectory = gitCommonDirectory(repoRoot).trim()
    return commonDirectory ? dirname(commonDirectory) : null
  } catch {
    return null
  }
}

export function installLocalCrmCredentials(
  options: InstallCredentialOptions
): InstallCredentialResult {
  const repoRoot = resolve(options.repoRoot)
  const env = options.env ?? process.env
  const locateMainCheckout = options.findMainCheckout ?? findMainCheckout
  const fileExists = options.fileExists ?? existsSync
  const readTextFile = options.readTextFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const mainCheckout = locateMainCheckout(repoRoot)

  // Merge from broad fallback to narrow override. Existing process variables
  // always win, and only the four server-side credential keys are admitted.
  const candidates = [
    mainCheckout ? join(mainCheckout, '.env.forge.local') : null,
    join(repoRoot, '.env.forge.local')
  ].filter((path): path is string => Boolean(path))
  const uniqueCandidates = [...new Set(candidates)]
  const fromFiles: Partial<Record<CredentialKey, string>> = {}
  const filesRead: string[] = []

  for (const path of uniqueCandidates) {
    if (!fileExists(path)) continue
    try {
      const parsed = parseDotEnv(readTextFile(path))
      Object.assign(fromFiles, parsed)
      filesRead.push(path)
    } catch {
      // A local credential file must not prevent the read-only console from
      // starting. Missing values remain explicit source errors in the UI.
    }
  }

  const loaded: CredentialKey[] = []
  for (const key of CREDENTIAL_KEYS) {
    if (env[key] || !fromFiles[key]) continue
    env[key] = fromFiles[key]
    loaded.push(key)
  }

  return { loaded, filesRead }
}
