import type { PrRef, ReviewSummary, Task } from '@zenuml/pr-panel-shared'
import type { PanelConnection, PanelMessageView, PanelPrefsView } from '../ui/types'

const repoKey = 'github.com/example-org/example-repo'
const url = (n: number) => `https://github.com/example-org/example-repo/pull/${n}`

export const REVIEWS: ReviewSummary[] = [
  {
    runId: 'r683', repoKey, prNumber: 683, url: url(683), priority: 'P1', prState: 'open', conflict: true, stale: false, completedAt: 1,
    headline: 'Make the first save succeed', summary: 'The first save and Agent Link pairing decide whether a user completes setup.',
    tags: ['Onboarding', 'Engagement'],
  },
  {
    runId: 'r684', repoKey, prNumber: 684, url: url(684), priority: 'P1', prState: 'draft', conflict: false, stale: false, completedAt: 2,
    headline: 'Show a usable example right after install', summary: 'Example pages and templates shorten the path to a first diagram; depends on #683.',
    tags: ['Onboarding', 'New feature'],
  },
  {
    runId: 'r888', repoKey, prNumber: 888, url: url(888), priority: 'P1', prState: 'draft', conflict: false, stale: true, completedAt: 3,
    headline: 'Help admins see where diagrams are used', summary: 'Lists the page each diagram sits on; permissions, paging and counts need follow-up.',
    tags: ['Revenue', 'UX', 'issue #893'],
  },
  {
    runId: 'r581', repoKey, prNumber: 581, url: url(581), priority: 'P2', prState: 'open', conflict: true, stale: false, completedAt: 4,
    headline: 'Turn customer follow-up into an actionable queue', summary: 'Combines licence and lifecycle signals to tell operations which customers to follow up.',
    tags: ['Revenue', 'Engagement'],
  },
]

/** Visual fixture for the current pinned P0 and merge-readiness layout. */
export const PREVIEW_REVIEWS: ReviewSummary[] = REVIEWS.map((item) => {
  if (item.prNumber === 683) return { ...item, priority: 'P0', readiness: 'blocked', readinessReason: 'Checks failed' }
  if (item.prNumber === 684) return { ...item, prState: 'open', readiness: 'ready' }
  if (item.prNumber === 581) return { ...item, readiness: 'ready' }
  return { ...item, readiness: 'unknown' }
})

export const PR_888: PrRef = { host: 'github.com', owner: 'example-org', repo: 'example-repo', number: 888, url: url(888),
  title: 'feat(plan-usage): Diagram locations screen lists where each diagram is used' }
export const PR_683: PrRef = { host: 'github.com', owner: 'example-org', repo: 'example-repo', number: 683, url: url(683),
  title: 'feat(onboarding): first save succeeds before pairing' }

const agent = { kind: 'claude_code' as const, sessionId: 's1', connectedAt: 0 }
export const TASK_WORKING: Task = { taskId: 't1', kind: 'review', repoKey, prNumber: 888, agent, status: 'working', label: 'Claude Code is reviewing #888', startedAt: 10 }
export const TASK_DONE: Task = { ...TASK_WORKING, status: 'finished', endedAt: 20 }

export const MESSAGES: PanelMessageView[] = [
  { id: 'm1', role: 'progress', text: 'Reading the diff (28 files)' },
  { id: 'm2', role: 'agent', text: 'Two findings so far: the list query ignores space permissions, and paging resets on filter change.' },
  { id: 'm3', role: 'user', text: 'Also check the empty state copy.', status: 'queued' },
  { id: 'm4', role: 'user', text: 'Thanks — ship it after that.', status: 'delivered' },
]

export const PREFS: PanelPrefsView = { panelCollapsed: false, preferencesHidden: false, mcpAccess: 'enabled', panelWidth: 240, panelPosition: null }

export interface PreviewState {
  id: string
  title: string
  note: string
  connection: PanelConnection
  task: Task | null
  pr: PrRef | null
  reviewFor: number | null
  prefs: PanelPrefsView
  messages: PanelMessageView[]
  list: boolean
}

/** The ten reference states of Figma 184:6368. */
export const STATES: PreviewState[] = [
  { id: '01', title: 'Server not running', note: 'MCP disconnected · expanded', connection: 'off', task: null, pr: PR_888, reviewFor: 888, prefs: PREFS, messages: [], list: false },
  { id: '02', title: 'Another tab active', note: 'MCP green dot · dashed border', connection: 'inactive', task: null, pr: PR_888, reviewFor: 888, prefs: PREFS, messages: [], list: false },
  { id: '03', title: 'This tab active', note: 'MCP green dot · solid border', connection: 'active', task: null, pr: PR_888, reviewFor: 888, prefs: PREFS, messages: MESSAGES.slice(2), list: false },
  { id: '04', title: 'Agent working', note: 'Task row · Stop', connection: 'active', task: TASK_WORKING, pr: PR_888, reviewFor: 888, prefs: PREFS, messages: MESSAGES.slice(0, 3), list: false },
  { id: '05', title: 'Task finished', note: 'Task row · Done', connection: 'active', task: TASK_DONE, pr: PR_888, reviewFor: 888, prefs: PREFS, messages: MESSAGES, list: false },
  { id: '06', title: 'Collapsed', note: 'Header only · expand control', connection: 'active', task: null, pr: PR_888, reviewFor: 888, prefs: { ...PREFS, panelCollapsed: true }, messages: [], list: false },
  { id: '07', title: 'Preferences hidden', note: 'PR, review and messages remain', connection: 'active', task: null, pr: PR_888, reviewFor: 888, prefs: { ...PREFS, preferencesHidden: true }, messages: MESSAGES.slice(1, 3), list: false },
  { id: '08', title: 'No pull request', note: 'Compact panel (/pulls page)', connection: 'active', task: null, pr: null, reviewFor: null, prefs: { ...PREFS, preferencesHidden: true }, messages: [], list: false },
  { id: '09', title: '#683 collapsed', note: 'Second GitHub page · list + collapsed panel', connection: 'inactive', task: null, pr: PR_683, reviewFor: 683, prefs: { ...PREFS, panelCollapsed: true }, messages: [], list: true },
  { id: '10', title: '#683 expanded', note: 'Second GitHub page · list + expanded panel', connection: 'inactive', task: null, pr: PR_683, reviewFor: 683, prefs: PREFS, messages: [], list: true },
]
