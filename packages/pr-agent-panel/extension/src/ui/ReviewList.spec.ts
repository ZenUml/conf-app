import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ReviewList from './ReviewList.vue'
import { REVIEWS } from '../preview/fixtures'

const meta = (r: { findAll(s: string): { text(): string }[] }) => r.findAll('.prl-meta-left span').map((s) => s.text()).join(' ')
const mountList = (currentPrNumber: number | null = 888) => mount(ReviewList, { props: { items: REVIEWS, currentPrNumber } })

describe('ReviewList', () => {
  it('renders one row per review in Hub order with ordinal, priority, number, status and tags', () => {
    const w = mountList()
    const rows = w.findAll('[data-testid="list-row"]')
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => meta(r))).toEqual([
      '01 P1 #683',
      '02 P1 #684',
      '03 P1 #888',
      '04 P2 #581',
    ])
    expect(rows[0]!.find('.prl-status').text()).toBe('Conflict')
    expect(rows[1]!.find('.prl-status').text()).toBe('Draft')
    expect(rows[1]!.find('.prl-meta').classes()).toContain('prl-meta-draft')
    expect(rows[0]!.find('.prl-title').text()).toBe(REVIEWS[0]!.headline)
    expect(rows[0]!.findAll('.prl-tags span').map((t) => t.text())).toEqual(['Onboarding', 'Engagement'])
  })

  it('marks the row of the PR currently open', () => {
    const rows = mountList(888).findAll('[data-testid="list-row"]')
    expect(rows.map((r) => r.classes().includes('prl-row-selected'))).toEqual([false, false, true, false])
    expect(rows[2]!.attributes('aria-current')).toBe('page')
  })

  it('shows a "PR updated" chip only on stale rows', () => {
    const rows = mountList().findAll('[data-testid="list-row"]')
    expect(rows.map((r) => r.find('[data-testid="stale-chip"]').exists())).toEqual([false, false, true, false])
    expect(rows[2]!.get('[data-testid="stale-chip"]').text()).toBe('PR updated')
  })

  it('click and Enter emit open with the item and its Hub index', async () => {
    const w = mountList()
    const rows = w.findAll('[data-testid="list-row"]')
    await rows[3]!.trigger('click')
    await rows[1]!.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('open')).toEqual([
      [REVIEWS[3], 3],
      [REVIEWS[1], 1],
    ])
  })

  it('search filters by headline, summary and #number, keeping the Hub ordinal', async () => {
    const w = mountList()
    const search = w.get('[data-testid="list-search"]')
    await search.setValue('admins')
    expect(w.findAll('[data-testid="list-row"]').map((r) => meta(r))).toEqual(['03 P1 #888'])
    await search.setValue('licence')
    expect(w.findAll('[data-testid="list-row"]')).toHaveLength(1)
    await search.setValue('#684')
    expect(w.findAll('[data-testid="list-row"]').map((r) => r.text())).toEqual([expect.stringContaining('#684')])
    await search.setValue('no such thing')
    expect(w.findAll('[data-testid="list-row"]')).toHaveLength(0)
    expect(w.get('[data-testid="list-empty"]').text()).toBe('No reviews match these filters.')
  })

  it('priority and state chips filter rows', async () => {
    const w = mountList()
    await w.get('[data-testid="filter-priority"]').setValue('P2')
    expect(w.findAll('[data-testid="list-row"]').map((r) => r.text())).toEqual([expect.stringContaining('#581')])
    await w.get('[data-testid="filter-priority"]').setValue('')
    await w.get('[data-testid="filter-state"]').setValue('draft')
    expect(w.findAll('[data-testid="list-row"]')).toHaveLength(2)
  })

  it('has the English placeholders and chips, the caption, and no count anywhere', () => {
    const w = mountList()
    expect(w.get('[data-testid="list-search"]').attributes('placeholder')).toBe('Search reviews')
    expect(w.get('[data-testid="filter-priority"] option').text()).toBe('All priorities ▾')
    expect(w.get('[data-testid="filter-state"] option').text()).toBe('All states ▾')
    expect(w.get('[data-testid="list-caption"]').text()).toBe('AI reviews · by priority')
    expect(w.text()).not.toMatch(/\d+\s*reviews?/i)
  })

  it('says so when the repository has no completed reviews', () => {
    const w = mount(ReviewList, { props: { items: [] } })
    expect(w.findAll('[data-testid="list-row"]')).toHaveLength(0)
    expect(w.get('[data-testid="list-empty"]').text()).toBe('No completed AI reviews in this repository yet.')
    expect(w.text()).not.toMatch(/\d+\s*reviews?/i)
  })

  it('shows the caller\'s empty text when it cannot know (Hub not connected)', () => {
    const w = mount(ReviewList, { props: { items: [], emptyText: 'The ZenUML Hub is not running.' } })
    expect(w.get('[data-testid="list-empty"]').text()).toBe('The ZenUML Hub is not running.')
  })

  it('hides merged PRs unless the state filter asks for them, but keeps the open PR\'s own row', async () => {
    const items = REVIEWS.map((r) => (r.prNumber === 684 || r.prNumber === 888 ? { ...r, prState: 'merged' as const } : r))
    const numbers = (w: ReturnType<typeof mount>) => w.findAll('[data-testid="list-row"]').map((r) => meta(r).split(' ')[2])

    const w = mount(ReviewList, { props: { items, currentPrNumber: 888 } })
    expect(numbers(w)).toEqual(['#683', '#888', '#581'])

    await w.setProps({ currentPrNumber: 581 })
    expect(numbers(w)).toEqual(['#683', '#581'])

    await w.get('[data-testid="filter-state"]').setValue('merged')
    expect(numbers(w)).toEqual(['#684', '#888'])
  })
})
