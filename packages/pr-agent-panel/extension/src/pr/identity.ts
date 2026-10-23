import { PrStateSchema, ShaSchema, type PrRef, type PrState, type RepoRef } from '@zenuml/pr-panel-shared'

/**
 * Title selectors, tried in order. The first three are the classic and early
 * React layouts; the last two match the React layout github.com serves in
 * 2026-10 (main header `h1 .markdown-title`, sticky header `PH_Title`).
 */
const TITLE_SELECTORS = [
  '.js-issue-title',
  'bdi.js-issue-title',
  '[data-component="PH_Title"] h1',
  '[data-component="PageHeader"] h1 .markdown-title',
  '[data-component="PH_Title"] .markdown-title',
]

const HEAD_SHA_SELECTORS = '[data-hovercard-type="commit"] .sha, .commit-ref ~ .sha'
const SHA_40 = /^[0-9a-f]{40}$/i

interface PathParts {
  host: string
  owner: string
  repo: string
  rest: string[]
}

function splitUrl(url: string): PathParts | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  const segments = u.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const [owner, repo, ...rest] = segments
  if (!owner || !repo) return null
  return { host: u.hostname.toLowerCase(), owner, repo, rest }
}

/** Repository of any `/owner/repo/...` page, used for the review list's repoKey on `/pulls`. */
export function parseRepoRef(url: string): RepoRef | null {
  const parts = splitUrl(url)
  if (!parts) return null
  const first = parts.rest[0]
  if (first !== 'pull' && first !== 'pulls') return null
  return { host: parts.host, owner: parts.owner, repo: parts.repo }
}

/**
 * The pull request a page shows: `/owner/repo/pull/N` and any sub-page
 * (`/files`, `/commits`, `/commits/<sha>`, `/checks`). `/pulls` and anything
 * else return null.
 */
export function parsePrRef(url: string, doc?: Document): PrRef | null {
  const parts = splitUrl(url)
  if (!parts) return null
  const [kind, num] = parts.rest
  if (kind !== 'pull' || !num || !/^\d+$/.test(num)) return null
  const number = Number(num)
  if (!Number.isSafeInteger(number) || number <= 0) return null

  const ref: PrRef = {
    host: parts.host,
    owner: parts.owner,
    repo: parts.repo,
    number,
    url: `https://${parts.host}/${parts.owner}/${parts.repo}/pull/${number}`,
  }
  // Never from a /commits/<sha> URL: that commit can be older than the PR head, and stale marking
  // and begin_task both need the head.
  const headSha = doc ? readHeadSha(doc, number) : undefined
  if (headSha) ref.headSha = headSha
  const title = doc ? readTitle(doc) : undefined
  if (title) ref.title = title
  return ref
}

export function readTitle(doc: Document): string | undefined {
  for (const selector of TITLE_SELECTORS) {
    const text = doc.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim()
    if (text) return text.slice(0, 300)
  }
  return undefined
}

/**
 * Best effort: a `.sha` next to the head ref (classic layout), else the
 * `headSha` field of the React app's embedded JSON. Undefined when neither is
 * present; an unknown head never marks a review stale (see `isStale`).
 */
export function readHeadSha(doc: Document, prNumber?: number): string | undefined {
  const fromDom = doc.querySelector(HEAD_SHA_SELECTORS)?.textContent?.trim()
  if (fromDom && ShaSchema.safeParse(fromDom).success) return fromDom.toLowerCase()
  for (const script of Array.from(doc.querySelectorAll('script[data-target="react-app.embeddedData"]'))) {
    // After a soft navigation the React app keeps the first page's data; trust it only for the PR it was rendered for.
    const initialPath = script.closest('react-app')?.getAttribute('initial-path')
    if (prNumber !== undefined && initialPath && !new RegExp(`/pull/${prNumber}(?:/|$)`).test(initialPath)) continue
    const match = /"headSha"\s*:\s*"([0-9a-f]{40})"/i.exec(script.textContent ?? '')
    if (match?.[1] && SHA_40.test(match[1])) return match[1].toLowerCase()
  }
  return undefined
}

/** PR state from the header's state label (`data-status="pullMerged"` etc.), or the label text. */
export function readPrState(doc: Document): PrState {
  const label = doc.querySelector('[data-component="StateLabel"][data-status], .State[title], .State')
  if (!label) return 'unknown'
  const raw = `${label.getAttribute('data-status') ?? ''} ${label.getAttribute('title') ?? ''} ${label.textContent ?? ''}`.toLowerCase()
  const state = raw.includes('draft')
    ? 'draft'
    : raw.includes('merged')
      ? 'merged'
      : raw.includes('closed')
        ? 'closed'
        : raw.includes('open')
          ? 'open'
          : 'unknown'
  return PrStateSchema.parse(state)
}
