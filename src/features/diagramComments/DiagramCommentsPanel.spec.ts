import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import DiagramCommentsPanel from './DiagramCommentsPanel.vue'
import { buildCommentLink } from './commentLink'
import type { CommentRequest } from './commentsClient'
import { resetPageCommentsCache } from './pageCommentsCache'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

const PAGE_URL = 'https://example.atlassian.net/wiki/spaces/OP/pages/42/Checkout'
const adfOf = (paragraphs: unknown[]) => JSON.stringify({ version: 1, type: 'doc', content: paragraphs })

function rootComment(id: string, opts: { diagramId?: string; version?: number; nonce?: string; text: string; authorId?: string; createdAt?: string }) {
  const href = buildCommentLink(PAGE_URL, { diagramId: opts.diagramId ?? 'cc-1', localId: 'loc-1', diagramVersion: opts.version, nonce: opts.nonce })
  return {
    id,
    version: { authorId: opts.authorId ?? 'u-reader', createdAt: opts.createdAt ?? '2026-11-01T10:00:00.000Z' },
    body: {
      atlas_doc_format: {
        value: adfOf([
          { type: 'paragraph', content: [{ type: 'text', text: opts.text }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Diagram', marks: [{ type: 'link', attrs: { href } }] }] },
        ]),
      },
    },
  }
}
function replyComment(id: string, text: string, authorId = 'u-editor', createdAt = '2026-11-01T11:00:00.000Z') {
  return {
    id,
    version: { authorId, createdAt },
    body: { atlas_doc_format: { value: adfOf([{ type: 'paragraph', content: [{ type: 'text', text }] }]) } },
  }
}

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

interface World {
  roots: any[]
  children: Record<string, any[]>
  users: Record<string, string>
  /** Called for POST /footer-comments; return a Response, or throw. */
  onPost?: (body: any, world: World) => any
  failRootsOnce?: boolean
}

function makeRequest(world: World) {
  const posts: any[] = []
  const request = vi.fn(async (url: string, method: string, body?: any) => {
    if (method === 'POST' && url === '/wiki/api/v2/users-bulk') {
      return res(200, { results: body.accountIds.filter((id: string) => world.users[id]).map((id: string) => ({ accountId: id, displayName: world.users[id] })) })
    }
    if (method === 'POST' && url === '/wiki/api/v2/footer-comments') {
      posts.push(body)
      return world.onPost ? world.onPost(body, world) : res(201, { id: 'new-1' })
    }
    if (method === 'GET' && /\/pages\/42\/footer-comments/.test(url)) {
      if (world.failRootsOnce) {
        world.failRootsOnce = false
        return res(429, {})
      }
      return res(200, { results: world.roots })
    }
    const child = url.match(/\/footer-comments\/([^/]+)\/children/)
    if (method === 'GET' && child) return res(200, { results: world.children[child[1]] ?? [] })
    return res(404, {})
  })
  return { request: request as unknown as CommentRequest & typeof request, posts }
}

const baseWorld = (): World => ({
  roots: [
    rootComment('c1', { version: 3, nonce: 'n1', text: 'Why is step 2 async?', authorId: 'u-reader', createdAt: '2026-11-01T10:00:00.000Z' }),
    rootComment('c2', { diagramId: 'cc-other', text: 'About another diagram', authorId: 'u-reader' }),
  ],
  children: { c1: [replyComment('r2', 'Second reply', 'u-editor', '2026-11-01T12:00:00.000Z'), replyComment('r1', 'First reply', 'u-editor', '2026-11-01T11:00:00.000Z')] },
  users: { 'u-reader': 'Mia Lin', 'u-editor': 'Eli Park', 'u-me': 'Me Myself' },
})

function mountPanel(request: CommentRequest, props: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return mount(DiagramCommentsPanel, {
    props: {
      pageId: '42',
      diagramId: 'cc-1',
      localId: 'loc-1',
      diagramVersion: 4,
      pageUrl: PAGE_URL,
      diagramTitle: 'Checkout flow',
      lastModifierId: 'u-editor',
      currentAccountId: 'u-me',
      macroType: 'sequence',
      request,
      ...props,
    },
    attachTo: host,
  })
}

const events = () => vi.mocked(trackAnalyticsEvent).mock.calls.map(([name]) => name)
const eventProps = (name: string) => vi.mocked(trackAnalyticsEvent).mock.calls.filter(([n]) => n === name).map(([, p]) => p)

async function type(wrapper: ReturnType<typeof mountPanel>, testid: string, text: string) {
  await wrapper.get(`[data-testid="${testid}"]`).setValue(text)
}

describe('DiagramCommentsPanel', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    resetPageCommentsCache()
  })

  it('shows a loading state, then threads with names and the diagram version', async () => {
    const { request } = makeRequest(baseWorld())
    const wrapper = mountPanel(request)
    expect(wrapper.find('[data-testid="diagram-comments-loading"]').exists()).toBe(true)
    await flushPromises()

    expect(wrapper.get('[data-testid="diagram-comments-title"]').text()).toBe('Comments · 1')
    const text = wrapper.text()
    expect(text).toContain('Mia Lin')
    expect(text).toContain('Why is step 2 async?')
    expect(text).toContain('Posted on diagram v3')
    expect(text).toContain('Eli Park')
    // Replies nested oldest first.
    expect(text.indexOf('First reply')).toBeLessThan(text.indexOf('Second reply'))
    // The "back to the diagram" line is not shown as text.
    expect(wrapper.findAll('[data-testid="diagram-comments-comment"]')).toHaveLength(3)
  })

  it('does not show comments about another diagram', async () => {
    const { request } = makeRequest(baseWorld())
    const wrapper = mountPanel(request)
    await flushPromises()
    expect(wrapper.text()).not.toContain('About another diagram')
  })

  it('lists the newest thread first', async () => {
    const world = baseWorld()
    world.roots.push(rootComment('c3', { text: 'Newer question', nonce: 'n3', createdAt: '2026-11-03T10:00:00.000Z' }))
    const wrapper = mountPanel(makeRequest(world).request)
    await flushPromises()
    const t = wrapper.text()
    expect(t.indexOf('Newer question')).toBeLessThan(t.indexOf('Why is step 2 async?'))
  })

  it('shows the empty state', async () => {
    const world = baseWorld()
    world.roots = []
    const wrapper = mountPanel(makeRequest(world).request)
    await flushPromises()
    expect(wrapper.get('[data-testid="diagram-comments-empty"]').text()).toContain('No discussion yet')
    expect(wrapper.get('[data-testid="diagram-comments-title"]').text()).toBe('Comments · 0')
  })

  it('falls back to "Someone" when names cannot be resolved', async () => {
    const world = baseWorld()
    world.users = {}
    const wrapper = mountPanel(makeRequest(world).request)
    await flushPromises()
    expect(wrapper.text()).toContain('Someone')
  })

  it('shows a load error and recovers on Retry', async () => {
    const world = baseWorld()
    world.failRootsOnce = true
    const wrapper = mountPanel(makeRequest(world).request)
    await flushPromises()
    expect(wrapper.get('[data-testid="diagram-comments-error"]').text()).toContain('Confluence is busy')
    expect(eventProps('diagram_comment_load_completed')[0]).toMatchObject({ comment_load_outcome: 'failed', comment_failure_reason: 'rate_limited' })

    await wrapper.get('[data-testid="diagram-comments-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="diagram-comments-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Why is step 2 async?')
    expect(eventProps('diagram_comment_load_completed')[1]).toMatchObject({ comment_load_outcome: 'succeeded', comment_count: 1 })
  })

  it('emits count after a successful load', async () => {
    const wrapper = mountPanel(makeRequest(baseWorld()).request)
    await flushPromises()
    expect(wrapper.emitted('count')).toEqual([[1]])
  })

  it('shows who will be asked to be notified, never as a fact', async () => {
    const wrapper = mountPanel(makeRequest(baseWorld()).request)
    await flushPromises()
    const line = wrapper.get('[data-testid="diagram-comments-notify"]').text()
    expect(line).toBe('Will notify: Eli Park (last editor)')
    expect(wrapper.text()).not.toMatch(/\b(was|were|been|got) (notified|delivered)/i)

    const solo = mountPanel(makeRequest(baseWorld()).request, { lastModifierId: 'u-me' })
    await flushPromises()
    expect(solo.get('[data-testid="diagram-comments-notify"]').text()).toBe('No one will be notified')
  })

  it('posts a root comment with the diagram link, a mention and then reloads; analytics carry no text', async () => {
    const world = baseWorld()
    const { request, posts } = makeRequest(world)
    world.onPost = (_body, w) => {
      w.roots.push(rootComment('c9', { version: 4, nonce: 'whatever', text: 'Is this final?', authorId: 'u-me' }))
      return res(201, { id: 'c9' })
    }
    const wrapper = mountPanel(request)
    await flushPromises()
    await type(wrapper, 'diagram-comments-input', '  Is this final?  ')
    await wrapper.get('[data-testid="diagram-comments-post"]').trigger('click')
    await flushPromises()

    expect(posts).toHaveLength(1)
    expect(posts[0].pageId).toBe('42')
    const adf = JSON.parse(posts[0].body.value)
    const json = JSON.stringify(adf)
    expect(json).toContain('"mention"')
    expect(json).toContain('u-editor')
    expect(json).toContain('Is this final?')
    const link = adf.content.at(-1).content[0]
    expect(link.text).toBe('Checkout flow · v4')
    const href = new URL(link.marks[0].attrs.href)
    expect(href.searchParams.get('zenumlDiagram')).toBe('cc-1')
    expect(href.searchParams.get('zenumlLocal')).toBe('loc-1')
    expect(href.searchParams.get('dv')).toBe('4')
    expect(href.searchParams.get('zn')).toMatch(/^[a-z0-9]{6}$/)

    expect(wrapper.get('[data-testid="diagram-comments-title"]').text()).toBe('Comments · 2')
    expect((wrapper.get('[data-testid="diagram-comments-input"]').element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.emitted('count')?.at(-1)).toEqual([2])

    expect(events()).toEqual([
      'diagram_comment_panel_opened',
      'diagram_comment_load_completed',
      'diagram_comment_submit_requested',
      'diagram_comment_submit_succeeded',
      'diagram_comment_load_completed',
    ])
    expect(eventProps('diagram_comment_submit_requested')[0]).toMatchObject({
      feature_area: 'diagram_comments',
      surface: 'fullscreen',
      macro_type: 'sequence',
      comment_thread_action: 'root',
      comment_mention_count: 1,
    })
    expect(eventProps('diagram_comment_submit_succeeded')[0]).toMatchObject({ comment_planned_recipient_count: 1 })
    const everything = JSON.stringify(vi.mocked(trackAnalyticsEvent).mock.calls)
    for (const secret of ['Is this final?', 'Mia Lin', 'Eli Park', 'u-editor', 'u-reader', 'u-me']) {
      expect(everything).not.toContain(secret)
    }
  })

  it('does not post twice on a double click', async () => {
    const world = baseWorld()
    let release: (v: unknown) => void = () => {}
    world.onPost = () => new Promise(resolve => (release = resolve))
    const { request, posts } = makeRequest(world)
    const wrapper = mountPanel(request)
    await flushPromises()
    await type(wrapper, 'diagram-comments-input', 'Hello')
    const button = wrapper.get('[data-testid="diagram-comments-post"]')
    void button.trigger('click')
    void button.trigger('click')
    await flushPromises()
    expect(posts).toHaveLength(1)
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
    release(res(201, { id: 'x' }))
    await flushPromises()
    expect(posts).toHaveLength(1)
  })

  it('cannot post empty or whitespace-only text', async () => {
    const { request, posts } = makeRequest(baseWorld())
    const wrapper = mountPanel(request)
    await flushPromises()
    await type(wrapper, 'diagram-comments-input', '   ')
    expect((wrapper.get('[data-testid="diagram-comments-post"]').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.get('[data-testid="diagram-comments-input"]').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(posts).toHaveLength(0)
  })

  it('posts with Ctrl+Enter', async () => {
    const { request, posts } = makeRequest(baseWorld())
    const wrapper = mountPanel(request)
    await flushPromises()
    await type(wrapper, 'diagram-comments-input', 'Quick note')
    await wrapper.get('[data-testid="diagram-comments-input"]').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(posts).toHaveLength(1)
  })

  it('Escape inside the compose box does not bubble up or close the panel', async () => {
    const wrapper = mountPanel(makeRequest(baseWorld()).request)
    await flushPromises()
    const outer = vi.fn()
    wrapper.element.parentElement?.addEventListener('keydown', outer)
    await wrapper.get('[data-testid="diagram-comments-input"]').trigger('keydown', { key: 'Escape' })
    expect(outer).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('uncertain save found by nonce counts as success without a second POST', async () => {
    const world = baseWorld()
    const { request, posts } = makeRequest(world)
    world.onPost = (body, w) => {
      const adf = JSON.parse(body.body.value)
      const href = adf.content.at(-1).content[0].marks[0].attrs.href
      const nonce = new URL(href).searchParams.get('zn')!
      w.roots.push(rootComment('c9', { version: 4, nonce, text: 'Saved anyway', authorId: 'u-me' }))
      throw new TypeError('Failed to fetch')
    }
    const wrapper = mountPanel(request)
    await flushPromises()
    await type(wrapper, 'diagram-comments-input', 'Saved anyway')
    await wrapper.get('[data-testid="diagram-comments-post"]').trigger('click')
    await flushPromises()

    expect(posts).toHaveLength(1)
    expect(wrapper.find('[data-testid="diagram-comments-post-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Saved anyway')
    expect(events()).toContain('diagram_comment_submit_succeeded')
    expect(events()).not.toContain('diagram_comment_submit_failed')
  })

  it('uncertain save not found keeps the draft, explains, and does not post again', async () => {
    const world = baseWorld()
    world.onPost = () => {
      throw new TypeError('Failed to fetch')
    }
    const { request, posts } = makeRequest(world)
    const wrapper = mountPanel(request)
    await flushPromises()
    await type(wrapper, 'diagram-comments-input', 'Maybe lost')
    await wrapper.get('[data-testid="diagram-comments-post"]').trigger('click')
    await flushPromises()

    expect(posts).toHaveLength(1)
    expect(wrapper.get('[data-testid="diagram-comments-post-error"]').text()).toBe(
      'We could not confirm the comment was saved. Check the list before posting again.',
    )
    expect((wrapper.get('[data-testid="diagram-comments-input"]').element as HTMLTextAreaElement).value).toBe('Maybe lost')
    expect(events()).not.toContain('diagram_comment_submit_succeeded')
  })

  it('a clear failure keeps the draft and reports a closed reason', async () => {
    const world = baseWorld()
    world.onPost = () => res(500, {})
    const wrapper = mountPanel(makeRequest(world).request)
    await flushPromises()
    await type(wrapper, 'diagram-comments-input', 'Will fail')
    await wrapper.get('[data-testid="diagram-comments-post"]').trigger('click')
    await flushPromises()
    expect(eventProps('diagram_comment_submit_failed')[0]).toMatchObject({ comment_thread_action: 'root', comment_failure_reason: 'unavailable' })
    expect((wrapper.get('[data-testid="diagram-comments-input"]').element as HTMLTextAreaElement).value).toBe('Will fail')
    expect(wrapper.find('[data-testid="diagram-comments-post-error"]').exists()).toBe(true)
  })

  it('posts a reply with parentCommentId, mentioning the thread author, with no link', async () => {
    const { request, posts } = makeRequest(baseWorld())
    const wrapper = mountPanel(request)
    await flushPromises()
    await wrapper.get('[data-testid="diagram-comments-reply-toggle"]').trigger('click')
    expect(wrapper.get('[data-testid="diagram-comments-reply-notify"]').text()).toBe('Will notify: Mia Lin')
    await type(wrapper, 'diagram-comments-reply-input', 'Thanks, clear now')
    await wrapper.get('[data-testid="diagram-comments-reply-post"]').trigger('click')
    await flushPromises()

    expect(posts).toHaveLength(1)
    expect(posts[0].parentCommentId).toBe('c1')
    expect(posts[0].pageId).toBeUndefined()
    const json = posts[0].body.value as string
    expect(json).toContain('u-reader')
    expect(json).not.toContain('zenumlDiagram')
    expect(eventProps('diagram_comment_submit_requested')[0]).toMatchObject({ comment_thread_action: 'reply', comment_mention_count: 1 })
  })

  it('uncertain reply is confirmed by an own comment with the same text', async () => {
    const world = baseWorld()
    world.onPost = (_b, w) => {
      w.children.c1.push(replyComment('r9', '@Mia Lin Thanks', 'u-me', '2026-11-02T00:00:00.000Z'))
      throw new TypeError('Failed to fetch')
    }
    const { request, posts } = makeRequest(world)
    const wrapper = mountPanel(request, {})
    await flushPromises()
    await wrapper.get('[data-testid="diagram-comments-reply-toggle"]').trigger('click')
    await type(wrapper, 'diagram-comments-reply-input', 'Thanks')
    await wrapper.get('[data-testid="diagram-comments-reply-post"]').trigger('click')
    await flushPromises()
    expect(posts).toHaveLength(1)
    expect(events()).toContain('diagram_comment_submit_succeeded')
  })

  it('permission denied on post hides the compose box and explains', async () => {
    const world = baseWorld()
    world.onPost = () => res(403, {})
    const wrapper = mountPanel(makeRequest(world).request)
    await flushPromises()
    await type(wrapper, 'diagram-comments-input', 'Not allowed')
    await wrapper.get('[data-testid="diagram-comments-post"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="diagram-comments-compose"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="diagram-comments-reply-toggle"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="diagram-comments-readonly"]').text()).toBe(
      'You can read this discussion but do not have permission to comment.',
    )
    expect(eventProps('diagram_comment_submit_failed')[0]).toMatchObject({ comment_failure_reason: 'permission_denied' })
  })

  it('close with a draft emits close and one dismissed event with comment_had_draft true', async () => {
    const wrapper = mountPanel(makeRequest(baseWorld()).request)
    await flushPromises()
    await type(wrapper, 'diagram-comments-input', 'half written')
    await wrapper.get('[data-testid="diagram-comments-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    const dismissed = eventProps('diagram_comment_dismissed')
    expect(dismissed).toHaveLength(1)
    expect(dismissed[0]).toMatchObject({ comment_had_draft: true, feature_area: 'diagram_comments', surface: 'fullscreen' })
  })

  it('unmount without a click still reports dismissed once, with no draft', async () => {
    const wrapper = mountPanel(makeRequest(baseWorld()).request, { macroType: undefined })
    await flushPromises()
    wrapper.unmount()
    const dismissed = eventProps('diagram_comment_dismissed')
    expect(dismissed).toHaveLength(1)
    expect(dismissed[0]).toMatchObject({ comment_had_draft: false, macro_type: 'none' })
  })
})
