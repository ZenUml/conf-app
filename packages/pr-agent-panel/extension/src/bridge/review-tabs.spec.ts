import { describe, expect, it } from 'vitest'
import type { ReviewGroup } from '@zenuml/pr-panel-shared'
import { ReviewTabs, urlMatchesPr, type BrowserTab, type ReviewTabApi } from './review-tabs'

const group: ReviewGroup = {
  groupId: 'g1', product: 'Widgets', requestedCount: 2, status: 'ready', createdAt: 1, updatedAt: 1,
  items: [7, 8].map((number) => ({
    pr: { host: 'github.com', owner: 'acme', repo: 'widgets', number, headSha: 'aaaaaaa1' },
    decisionTitle: `Review ${number}`, ci: 'unknown' as const, materialHeadSha: 'aaaaaaa1', materialUpdatedAt: 1,
    outcome: number === 7 ? 'merged' as const : 'pending' as const,
  })),
}

function fakeTabs() {
  let ownedId: number | null = null
  const tabs = new Map<number, BrowserTab>()
  const created: Array<{ url: string; active: boolean }> = []
  const updated: Array<{ id: number; url: string; active: boolean }> = []
  const api: ReviewTabApi = {
    create: async (url, active) => {
      const id = tabs.size + 10
      tabs.set(id, { id, url })
      created.push({ url, active })
      return { id, url }
    },
    get: async (id) => {
      const tab = tabs.get(id)
      if (!tab) throw new Error('closed')
      return tab
    },
    update: async (id, url, active) => { tabs.set(id, { id, url }); updated.push({ id, url, active }) },
    getOwnedId: async () => ownedId,
    setOwnedId: async (id) => { ownedId = id },
  }
  return { api, tabs, created, updated, owned: () => ownedId }
}

describe('owned review tab navigation', () => {
  it('opens the first pending item in the background, then Continue resumes and focuses the same owned tab', async () => {
    const fake = fakeTabs()
    const nav = new ReviewTabs(fake.api)
    await nav.openInitial(group)
    expect(fake.created).toEqual([{ url: 'https://github.com/acme/widgets/pull/8', active: false }])
    await nav.continue(group)
    expect(fake.updated).toEqual([{ id: fake.owned(), url: 'https://github.com/acme/widgets/pull/8', active: true }])
  })

  it('does not advance an unrelated tab or a tab that left the target', async () => {
    const fake = fakeTabs()
    const nav = new ReviewTabs(fake.api)
    const pending = { ...group, items: group.items.map((item) => ({ ...item, outcome: 'pending' as const })) }
    await nav.openInitial(pending)
    const id = fake.owned()!
    expect(await nav.advanceAfterAi(group, pending.items[0]!.pr, id + 1)).toBe(false)
    fake.tabs.set(id, { id, url: 'https://github.com/acme/widgets/pull/99' })
    expect(await nav.advanceAfterAi(group, pending.items[0]!.pr, id)).toBe(false)
    expect(fake.updated).toEqual([])
    await nav.continue(group)
    expect(fake.created).toHaveLength(2)
    expect(fake.created[1]?.active).toBe(true)
  })

  it('advances without requesting browser activation when the owned tab still shows the target', async () => {
    const fake = fakeTabs()
    const nav = new ReviewTabs(fake.api)
    const pending = { ...group, items: group.items.map((item) => ({ ...item, outcome: 'pending' as const })) }
    await nav.openInitial(pending)
    const id = fake.owned()!
    expect(await nav.advanceAfterAi(group, pending.items[0]!.pr, id)).toBe(true)
    expect(fake.updated).toEqual([{ id, url: 'https://github.com/acme/widgets/pull/8', active: false }])
  })
})

describe('urlMatchesPr', () => {
  const pr7 = { host: 'github.com', owner: 'acme', repo: 'widgets', number: 7 }
  it('matches the PR and its sub-pages, never a PR whose number only starts with the same digits', () => {
    expect(urlMatchesPr('https://github.com/acme/widgets/pull/7', pr7)).toBe(true)
    expect(urlMatchesPr('https://github.com/acme/widgets/pull/7/files', pr7)).toBe(true)
    expect(urlMatchesPr('https://github.com/acme/widgets/pull/70', pr7)).toBe(false)
    expect(urlMatchesPr('https://github.com/acme/widgets/pull/71/files', pr7)).toBe(false)
  })
})
