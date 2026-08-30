import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildExtensionsResponse,
  type RawGrantValue
} from './extensionsData'
import type {
  ExtensionSourceName,
  ExtensionsResponse
} from '../src/data/extensionsContract'

const execFileAsync = promisify(execFile)
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const WRANGLER = join(REPO_ROOT, 'node_modules', '.bin', 'wrangler')
const MARKETPLACE_EXPORT =
  'https://marketplace.atlassian.com/rest/2/vendors/1215266/reporting/licenses/export?accept=json'
const JSM_ORIGIN = 'https://zenuml.atlassian.net'
const SOURCE_TIMEOUT_MS = 60_000
const CACHE_MS = 30_000

type JsonRecord = Record<string, unknown>

let cached: { expiresAt: number; value: Promise<ExtensionsResponse> } | null = null
let marketplaceCached: { expiresAt: number; value: Promise<unknown[]> } | null = null

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function errorDetail(source: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const firstLine = raw.replace(/\x1b\[[0-9;]*m/g, '').split('\n').find(Boolean)
  return `${source} unavailable${firstLine ? `: ${firstLine.slice(0, 180)}` : ''}`
}

function parseCommandJson<T>(stdout: string): T {
  const clean = stdout
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\nSuccess!\s*$/s, '')
    .trim()
  const starts: number[] = []
  for (let index = 0; index < clean.length; index += 1) {
    if (clean[index] === '[' || clean[index] === '{') starts.push(index)
  }
  for (const start of starts) {
    try {
      return JSON.parse(clean.slice(start)) as T
    } catch {
      // Wrangler can print a banner before its JSON. Try the next JSON token.
    }
  }
  throw new Error('command did not return JSON')
}

async function runWrangler(args: string[]): Promise<string> {
  const result = await execFileAsync(WRANGLER, args, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      WRANGLER_SEND_METRICS: 'false'
    },
    timeout: SOURCE_TIMEOUT_MS,
    maxBuffer: 30 * 1024 * 1024
  })
  return result.stdout
}

async function loadGrantValues(): Promise<RawGrantValue[]> {
  const common = [
    '--binding', 'SPACE_LICENSE_KV',
    '--config', 'wrangler-prod.toml',
    '--env', 'production',
    '--remote'
  ]
  const listed = parseCommandJson<unknown[]>(await runWrangler([
    'kv', 'key', 'list', ...common, '--prefix', 'license:'
  ]))
  const keys = listed.flatMap(item => {
    const name = record(item)?.name
    return typeof name === 'string' ? [name] : []
  })
  if (!keys.length) return []

  const temp = await mkdtemp(join(tmpdir(), 'local-crm-kv-'))
  const input = join(temp, 'keys.json')
  try {
    await writeFile(input, JSON.stringify(keys), { mode: 0o600 })
    const bulk = parseCommandJson<JsonRecord>(await runWrangler([
      'kv', 'bulk', 'get', input, ...common
    ]))
    const values = keys.flatMap(key => {
      const raw = bulk[key]
      const wrapped = record(raw)
      const serialized = typeof raw === 'string'
        ? raw
        : typeof wrapped?.value === 'string'
          ? wrapped.value
          : null
      if (!serialized) return []
      try {
        return [{ key, value: JSON.parse(serialized) }]
      } catch {
        return []
      }
    })
    if (values.length !== keys.length) {
      throw new Error(`KV bulk read returned ${values.length} parseable values for ${keys.length} keys`)
    }
    return values
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

async function loadRequiredGrantValues(): Promise<RawGrantValue[]> {
  try {
    return await loadGrantValues()
  } catch {
    // One bounded retry keeps a transient CLI startup failure from pinning the
    // UI to fixtures for the rest of the page session. The first observed
    // failure did not establish a more specific cause.
    return await loadGrantValues()
  }
}

function basicAuth(user: string, token: string): string {
  return `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`
}

async function fetchJson(url: string, init: RequestInit, label: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function loadMarketplaceUncached(): Promise<unknown[]> {
  const user = process.env.FORGE_EMAIL
  const token = process.env.FORGE_API_TOKEN
  if (!user || !token) throw new Error('FORGE_EMAIL/FORGE_API_TOKEN are not set')
  const body = await fetchJson(MARKETPLACE_EXPORT, {
    headers: {
      accept: 'application/json',
      authorization: basicAuth(user, token)
    }
  }, 'Marketplace')
  if (!Array.isArray(body)) throw new Error('Marketplace export was not an array')
  return body
}

/** Shared, server-only Marketplace read for all Local CRM projections. */
export function loadMarketplaceRows(options: { fresh?: boolean } = {}): Promise<unknown[]> {
  if (!options.fresh && marketplaceCached && marketplaceCached.expiresAt > Date.now()) {
    return marketplaceCached.value
  }
  const value = loadMarketplaceUncached()
  marketplaceCached = { expiresAt: Date.now() + CACHE_MS, value }
  value.catch(() => {
    if (marketplaceCached?.value === value) marketplaceCached = null
  })
  return value
}

function ticketsFromGrants(grants: RawGrantValue[]): string[] {
  const tickets = grants.flatMap(({ value }) => {
    const activatedBy = record(value)?.activatedBy
    if (typeof activatedBy !== 'string') return []
    const ticket = activatedBy.match(/\bZEN-[1-9][0-9]*\b/i)?.[0]
    return ticket ? [ticket.toUpperCase()] : []
  })
  return [...new Set(tickets)].sort()
}

function jsmHistoryStart(grants: RawGrantValue[]): string | null {
  const timestamps = grants.flatMap(({ value }) => {
    const createdAt = record(value)?.createdAt
    if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) return []
    return [Date.parse(createdAt)]
  })
  if (!timestamps.length) return null
  const start = new Date(Math.min(...timestamps) - 31 * 86_400_000)
  return start.toISOString().slice(0, 10)
}

async function jsmSearch(jql: string, authorization: string): Promise<unknown[]> {
  const issues: unknown[] = []
  let nextPageToken: string | null = null
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({
      jql,
      fields: 'summary,created,updated,status,reporter,customfield_10070,description',
      maxResults: '100'
    })
    if (nextPageToken) query.set('nextPageToken', nextPageToken)
    const body = record(await fetchJson(`${JSM_ORIGIN}/rest/api/3/search/jql?${query}`, {
      headers: { accept: 'application/json', authorization }
    }, 'JSM search'))
    const pageIssues = Array.isArray(body?.issues) ? body.issues : []
    issues.push(...pageIssues)
    nextPageToken = typeof body?.nextPageToken === 'string' ? body.nextPageToken : null
    if (!nextPageToken || pageIssues.length === 0) break
  }
  return issues
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      out[index] = await worker(values[index])
    }
  }))
  return out
}

async function loadJsm(grants: RawGrantValue[]): Promise<{
  issues: unknown[]
  comments: Map<string, unknown[] | null>
}> {
  const user = process.env.JSM_EMAIL
  const token = process.env.JSM_API_TOKEN
  if (!user || !token) throw new Error('JSM_EMAIL/JSM_API_TOKEN are not set')
  const authorization = basicAuth(user, token)
  const tickets = ticketsFromGrants(grants)
  const historyStart = jsmHistoryStart(grants)
  const searches: Promise<unknown[]>[] = [
    jsmSearch('project = ZEN AND statusCategory != Done ORDER BY created ASC', authorization)
  ]
  if (historyStart) {
    searches.push(jsmSearch(`project = ZEN AND created >= "${historyStart}" ORDER BY created ASC`, authorization))
  }
  if (tickets.length) searches.push(jsmSearch(`key in (${tickets.join(',')})`, authorization))
  const issueSets = await Promise.all(searches)
  const byKey = new Map<string, unknown>()
  issueSets.flat().forEach(issue => {
    const key = record(issue)?.key
    if (typeof key === 'string') byKey.set(key, issue)
  })
  const issues = [...byKey.values()]
  const commentEntries = await mapLimit(issues, 8, async issue => {
    const key = record(issue)?.key
    if (typeof key !== 'string') return null
    try {
      const body = record(await fetchJson(
        `${JSM_ORIGIN}/rest/api/3/issue/${encodeURIComponent(key)}/comment?maxResults=100`,
        { headers: { accept: 'application/json', authorization } },
        `JSM comments for ${key}`
      ))
      const comments = Array.isArray(body?.comments) ? body.comments : []
      if (typeof body?.total === 'number' && body.total > comments.length) {
        return [key, null] as const
      }
      return [key, comments] as const
    } catch {
      return [key, null] as const
    }
  })
  return {
    issues,
    comments: new Map(commentEntries.filter((entry): entry is NonNullable<typeof entry> => entry !== null))
  }
}

async function loadActionRows(): Promise<unknown[]> {
  const sql = `SELECT ticketKey, action, status, clientDomain, cloudId, spaceKey,
    userAccountId, macroCount, expiresAt, createdAt, updatedAt
    FROM ExtensionAction ORDER BY createdAt`
  const output = await runWrangler([
    'd1', 'execute', 'conf-zenuml-prod',
    '--config', 'wrangler-prod.toml',
    '--env', 'production',
    '--remote', '--json', '--command', sql
  ])
  const batches = parseCommandJson<unknown[]>(output)
  const first = record(batches[0])
  return Array.isArray(first?.results) ? first.results : []
}

async function loadFresh(): Promise<ExtensionsResponse> {
  const generatedAt = new Date().toISOString()
  const sourceErrors: Partial<Record<ExtensionSourceName, string>> = {}

  let grantValues: RawGrantValue[]
  try {
    grantValues = await loadRequiredGrantValues()
  } catch (error) {
    throw new Error(errorDetail('SPACE_LICENSE_KV', error))
  }

  const [marketplaceResult, jsmResult, actionResult] = await Promise.allSettled([
    loadMarketplaceRows(),
    loadJsm(grantValues),
    loadActionRows()
  ])
  const marketplaceRows = marketplaceResult.status === 'fulfilled' ? marketplaceResult.value : []
  if (marketplaceResult.status === 'rejected') {
    sourceErrors.marketplace = errorDetail('Marketplace', marketplaceResult.reason)
  }
  const jsmIssues = jsmResult.status === 'fulfilled' ? jsmResult.value.issues : []
  const jsmCommentsByTicket = jsmResult.status === 'fulfilled'
    ? jsmResult.value.comments
    : new Map<string, unknown[] | null>()
  if (jsmResult.status === 'rejected') sourceErrors.jsm = errorDetail('JSM', jsmResult.reason)
  const actionRows = actionResult.status === 'fulfilled' ? actionResult.value : []
  if (actionResult.status === 'rejected') {
    sourceErrors.extension_action_d1 = errorDetail('ExtensionAction D1', actionResult.reason)
  }

  return buildExtensionsResponse({
    generatedAt,
    marketplaceRows,
    jsmIssues,
    jsmCommentsByTicket,
    grantValues,
    actionRows,
    sourceErrors
  })
}

export function loadExtensionsResponse(options: { fresh?: boolean } = {}): Promise<ExtensionsResponse> {
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.value
  const value = loadFresh()
  cached = { expiresAt: Date.now() + CACHE_MS, value }
  value.catch(() => {
    if (cached?.value === value) cached = null
  })
  return value
}
