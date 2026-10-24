import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ReviewList from './ReviewList.vue'
import { REVIEWS } from '../preview/fixtures'

const meta = (r: { findAll(s: string): { text(): string }[] }) => r.findAll('.prl-meta-left span').map((s) => s.text()).join(' ')
const mountList = (currentPrNumber: number | null = 888) => mount(ReviewList, { props: { items: REVIEWS, currentPrNumber } })

let availableHeight = 0
const dimensions = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
  const height = this.classList.contains('prl-viewport') ? availableHeight : this.classList.contains('prl-row') ? 100 : 0
  return { x: 0, y: 0, top: 0, left: 0, right: 319, bottom: height, width: 319, height, toJSON: () => ({}) } as DOMRect
})

afterEach(() => {
  availableHeight = 0
  dimensions.mockClear()
})

async function mountAtHeight(height: number) {
  availableHeight = height
  const wrapper = mountList()
  await flushPromises()
  return wrapper
}

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
    expect(rows[0]!.find('.prl-status').text()).toContain('Review conflict')
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
    expect(w.get('[data-testid="list-caption"]').text()).toBe('AI reviews · ready first')
    expect(w.text()).not.toMatch(/\d+\s*reviews?/i)
  })

  it('says so when the repository has no completed reviews', () => {
    const w = mount(ReviewList, { props: { items: [] } })
    expect(w.findAll('[data-testid="list-row"]')).toHaveLength(0)
    expect(w.get('[data-testid="list-empty"]').text()).toBe('No completed AI reviews in this repository yet.')
    expect(w.text()).not.toMatch(/\d+\s*reviews?/i)
  })

  it('removes only the deleted PR row when the Hub sends a replacement list', async () => {
    const w = mountList()
    const remaining = REVIEWS.filter((item) => item.prNumber !== 888)
    await w.setProps({ items: remaining })
    const numbers = w.findAll('[data-testid="list-row"]').map((row) => row.text().match(/#\d+/)?.[0])
    expect(numbers).toEqual(['#683', '#684', '#581'])
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

  it('uses the measured viewport height, reserves controls, and pages complete rows', async () => {
    const w = await mountAtHeight(205)
    expect(w.findAll('[data-testid="list-row"]')).toHaveLength(2)
    expect(w.get('[data-testid="page-label"]').text()).toBe('Page 1 of 2')
    expect(w.get('[data-testid="page-prev"]').attributes('disabled')).toBeDefined()
    await w.get('[data-testid="page-next"]').trigger('click')
    expect(w.findAll('[data-testid="list-row"]').map((r) => meta(r))).toEqual(['03 P1 #888', '04 P2 #581'])
    expect(w.get('[data-testid="page-label"]').text()).toBe('Page 2 of 2')
  })

  it('recomputes on resize and keeps the first visible review in view', async () => {
    const w = await mountAtHeight(205)
    await w.get('[data-testid="page-next"]').trigger('click')
    availableHeight = 105
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(w.get('[data-testid="page-label"]').text()).toBe('Page 3 of 4')
    expect(w.findAll('[data-testid="list-row"]').map((r) => meta(r))).toEqual(['03 P1 #888'])
  })

  it('clamps the page after deletion and updates row state without resetting to page one', async () => {
    const w = await mountAtHeight(205)
    await w.get('[data-testid="page-next"]').trigger('click')
    await w.setProps({ items: REVIEWS.filter((item) => item.prNumber !== 888) })
    await flushPromises()
    expect(w.get('[data-testid="page-label"]').text()).toBe('Page 2 of 2')
    expect(w.findAll('[data-testid="list-row"]').map((r) => meta(r))).toEqual(['03 P2 #581'])
    await w.setProps({ items: REVIEWS.filter((item) => item.prNumber !== 888).map((item) => item.prNumber === 581 ? { ...item, prState: 'closed' as const, stale: true, conflict: false } : item) })
    await flushPromises()
    expect(w.get('[data-testid="page-label"]').text()).toBe('Page 2 of 2')
    expect(w.get('[data-testid="list-row"]').find('.prl-status').text()).toContain('Closed')
    expect(w.get('[data-testid="stale-chip"]').text()).toBe('PR updated')
  })

  it('resets to the first page on a filter change and hides pagination on an empty result', async () => {
    const w = await mountAtHeight(105)
    await w.get('[data-testid="page-next"]').trigger('click')
    await w.get('[data-testid="filter-priority"]').setValue('P2')
    await flushPromises()
    expect(w.get('[data-testid="page-label"]').text()).toBe('Page 1 of 1')
    await w.get('[data-testid="list-search"]').setValue('no result')
    await flushPromises()
    expect(w.find('[data-testid="list-pagination"]').exists()).toBe(false)
    expect(w.get('[data-testid="list-empty"]').text()).toBe('No reviews match these filters.')
  })

  it('pins P0 across pages and sorts ordinary reviews by readiness without changing business ordinals', async () => {
    const items = REVIEWS.map((item) => {
      if (item.prNumber === 683) return { ...item, priority: 'P0' as const, readiness: 'blocked' as const, readinessReason: 'Checks failed' }
      if (item.prNumber === 684 || item.prNumber === 581) return { ...item, readiness: 'ready' as const }
      return { ...item, readiness: 'unknown' as const }
    })
    availableHeight = 105
    const w = mount(ReviewList, { props: { items, currentPrNumber: 888 } })
    await flushPromises()
    expect(w.get('[data-testid="pinned-reviews"]').findAll('[data-testid="list-row"]')).toHaveLength(1)
    expect(w.get('[data-testid="pinned-reviews"]').text()).toContain('Blocked')
    expect(w.get('[data-testid="pinned-reviews"]').text()).toContain('Checks failed')
    expect(w.get('.prl-viewport [data-testid="list-row"]').text()).toContain('#684')
    expect(w.get('[data-testid="page-label"]').text()).toBe('Page 1 of 3')

    await w.get('[data-testid="page-next"]').trigger('click')
    expect(w.get('[data-testid="pinned-reviews"]').text()).toContain('#683')
    expect(w.get('.prl-viewport [data-testid="list-row"]').text()).toContain('#581')
    expect(w.get('.prl-viewport [data-testid="list-row"] .prl-meta-left').text()).toContain('04')
    await w.get('[data-testid="page-next"]').trigger('click')
    expect(w.get('.prl-viewport [data-testid="readiness-label"]').text()).toBe('Readiness unknown')
    expect(w.get('[data-testid="pinned-reviews"]').text()).toContain('#683')
  })

  it('keeps a P0 review visible regardless of ordinary search, priority, and state filters', async () => {
    const items = REVIEWS.map((item) => item.prNumber === 683 ? { ...item, priority: 'P0' as const } : item)
    const w = mount(ReviewList, { props: { items } })
    await w.get('[data-testid="filter-priority"]').setValue('P2')
    await w.get('[data-testid="filter-state"]').setValue('merged')
    await w.get('[data-testid="list-search"]').setValue('no ordinary match')
    await flushPromises()
    expect(w.get('[data-testid="pinned-reviews"]').text()).toContain('#683')
    expect(w.find('[data-testid="list-pagination"]').exists()).toBe(false)
    expect(w.get('[data-testid="list-empty"]').text()).toBe('No other reviews match these filters.')

    await w.setProps({ items: [items[0]!] })
    await flushPromises()
    expect(w.get('[data-testid="pinned-reviews"]').text()).toContain('#683')
    expect(w.get('[data-testid="list-empty"]').text()).toBe('No other completed AI reviews.')
  })
})
