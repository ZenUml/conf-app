// Root tsc uses legacy Node resolution; Storybook 10 exposes these through
// package exports. The Storybook/Vite build resolves them (as existing stories do).
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import type { Meta, StoryObj } from '@storybook/vue3-vite'
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import { expect, userEvent, within } from 'storybook/test'
import mixpanel from 'mixpanel-browser'
import DiagramCommentsPanel from './DiagramCommentsPanel.vue'
import { buildCommentLink } from './commentLink'
import type { CommentRequest } from './commentsClient'
import { resetPageCommentsCache } from './pageCommentsCache'

/**
 * The fullscreen diagram-comments rail. The panel takes its Confluence
 * `request` function as a prop, so every story here runs on canned responses:
 * no Forge bridge, no Confluence, no customer data. All names, ids and text are
 * invented.
 */

const PAGE_URL = 'https://example.atlassian.net/wiki/spaces/OP/pages/42/Checkout'

const adf = (paragraphs: unknown[]) => JSON.stringify({ version: 1, type: 'doc', content: paragraphs })

function root(id: string, text: string, authorId: string, createdAt: string, version: number) {
  const href = buildCommentLink(PAGE_URL, { diagramId: 'cc-1', localId: 'loc-1', diagramVersion: version, nonce: `n${id}` })
  return {
    id,
    version: { authorId, createdAt },
    body: {
      atlas_doc_format: {
        value: adf([
          { type: 'paragraph', content: [{ type: 'text', text }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Checkout flow', marks: [{ type: 'link', attrs: { href } }] }] },
        ]),
      },
    },
  }
}
const reply = (id: string, text: string, authorId: string, createdAt: string) => ({
  id,
  version: { authorId, createdAt },
  body: { atlas_doc_format: { value: adf([{ type: 'paragraph', content: [{ type: 'text', text }] }]) } },
})

const USERS: Record<string, string> = { 'u-reader': 'Mia Lin', 'u-editor': 'Eli Park', 'u-me': 'Sam Rivera' }

const ROOTS = [
  root('c1', 'Why is the refund step asynchronous?', 'u-reader', '2026-11-01T10:00:00.000Z', 3),
  root('c2', 'Could we add the retry path here?', 'u-me', '2026-11-02T09:30:00.000Z', 4),
]
const CHILDREN: Record<string, unknown[]> = {
  c1: [
    reply('r1', 'The ledger confirms it later, so we do not block the user.', 'u-editor', '2026-11-01T11:00:00.000Z'),
    reply('r2', 'Makes sense, thanks.', 'u-reader', '2026-11-01T12:15:00.000Z'),
  ],
}

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function fakeRequest(opts: { roots?: unknown[]; failLoad?: boolean; denyPost?: boolean }): CommentRequest {
  return async (url, method) => {
    if (method === 'POST' && url === '/wiki/api/v2/users-bulk') {
      return res(200, { results: Object.entries(USERS).map(([accountId, displayName]) => ({ accountId, displayName })) })
    }
    if (method === 'POST' && url === '/wiki/api/v2/footer-comments') return opts.denyPost ? res(403, {}) : res(201, { id: 'new' })
    if (method === 'GET' && /\/pages\/[^/]+\/footer-comments/.test(url)) {
      return opts.failLoad ? res(503, {}) : res(200, { results: opts.roots ?? ROOTS })
    }
    const child = url.match(/\/footer-comments\/([^/]+)\/children/)
    if (method === 'GET' && child) return res(200, { results: CHILDREN[child[1]] ?? [] })
    return res(404, {})
  }
}

function quietAnalytics() {
  // Storybook has no analytics token; keep the console clean.
  const noop = () => {}
  ;(mixpanel as any).init = noop
  ;(mixpanel as any).register = noop
  ;(mixpanel as any).track = noop
  resetPageCommentsCache()
}

const meta: Meta<typeof DiagramCommentsPanel> = {
  title: 'Viewer/DiagramCommentsPanel',
  component: DiagramCommentsPanel,
  parameters: { layout: 'fullscreen' },
  args: {
    pageId: '42',
    diagramId: 'cc-1',
    localId: 'loc-1',
    diagramVersion: 4,
    pageUrl: PAGE_URL,
    diagramTitle: 'Checkout flow',
    lastModifierId: 'u-editor',
    currentAccountId: 'u-me',
    macroType: 'sequence',
  },
  render: (args: Record<string, unknown>) => {
    quietAnalytics()
    return {
      components: { DiagramCommentsPanel },
      setup: () => ({ args }),
      template: '<div style="display:flex;justify-content:flex-end;height:720px;background:#f7f8fa"><DiagramCommentsPanel v-bind="args" /></div>',
    }
  },
}

export default meta
type Story = StoryObj<typeof DiagramCommentsPanel>

/** Two threads, newest first; the first has two replies. */
export const List: Story = {
  args: { request: fakeRequest({}) },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('diagram-comments-list')
    await expect(canvas.getByTestId('diagram-comments-title')).toHaveTextContent('Comments · 2')
    await expect(canvas.getByText('Posted on diagram v3')).toBeVisible()
    await expect(canvas.getByTestId('diagram-comments-notify')).toHaveTextContent('Will notify: Eli Park (last editor)')
  },
}

/** Nobody has said anything about this diagram yet. */
export const Empty: Story = {
  args: { request: fakeRequest({ roots: [] }) },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByTestId('diagram-comments-empty')).toHaveTextContent('No discussion yet')
  },
}

/** Confluence is unavailable: a plain message and a Retry button, never a thrown error. */
export const LoadError: Story = {
  args: { request: fakeRequest({ failLoad: true }) },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByTestId('diagram-comments-error')).toBeVisible()
    await expect(canvas.getByTestId('diagram-comments-retry')).toBeVisible()
  },
}

/**
 * The reader may read but not comment. Confluence only says so when a post is
 * refused, so this story posts once to reach that state.
 */
export const ReadOnly: Story = {
  args: { request: fakeRequest({ denyPost: true }) },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByTestId('diagram-comments-input')
    await userEvent.type(input, 'Can I comment?')
    await userEvent.click(canvas.getByTestId('diagram-comments-post'))
    await expect(await canvas.findByTestId('diagram-comments-readonly')).toHaveTextContent('do not have permission to comment')
  },
}
