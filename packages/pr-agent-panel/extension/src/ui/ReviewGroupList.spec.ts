import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ReviewGroup } from '@zenuml/pr-panel-shared'
import ReviewGroupList from './ReviewGroupList.vue'

const group: ReviewGroup = {
  groupId: 'round-1', product: 'Example', requestedCount: 2, status: 'ready', createdAt: 1, updatedAt: 2,
  items: [
    { pr: { host: 'github.com', owner: 'example-owner', repo: 'example-repo', number: 7 }, decisionTitle: 'Review first', ci: 'success', materialHeadSha: 'aaaaaaa', materialUpdatedAt: 1, outcome: 'pending' },
    { pr: { host: 'github.com', owner: 'example-owner', repo: 'example-repo', number: 8 }, decisionTitle: 'Review second', ci: 'pending', materialHeadSha: 'bbbbbbb', materialUpdatedAt: 1, outcome: 'pending' },
  ],
}

describe('ReviewGroupList completion transition', () => {
  it('shows the completed row, highlights the next PR, and provides keyboard-focusable Next and Stay actions', async () => {
    const wrapper = mount(ReviewGroupList, { props: { group, preparation: null, currentPrNumber: 7, completedItem: null, autoAdvance: false, offline: false } })
    expect(wrapper.find('[data-testid="completed-row"]').exists()).toBe(false)
    const completed: ReviewGroup = { ...group, items: [{ ...group.items[0]!, outcome: 'merged' }, group.items[1]!] }
    await wrapper.setProps({ group: completed, completedItem: completed.items[0]!, autoAdvance: true })
    expect(wrapper.find('[data-testid="completed-row"]').text()).toContain('Merged · completed')
    expect(wrapper.find('.rg-row-next').text()).toContain('Review second')
    expect(wrapper.find('.rg-completion').text()).toContain('Opening next in 3 seconds')
    expect(wrapper.get('.rg-next').element.tagName).toBe('BUTTON')
    expect(wrapper.get('.rg-stay').element.tagName).toBe('BUTTON')
    await wrapper.get('.rg-stay').trigger('click')
    expect(wrapper.emitted('stay')).toHaveLength(1)
    await wrapper.setProps({ autoAdvance: false })
    expect(wrapper.find('.rg-completion').text()).toContain('Staying here')
    await wrapper.get('.rg-next').trigger('click')
    expect(wrapper.emitted('next')).toHaveLength(1)
  })

  it('shows a final round completion without offering another PR', () => {
    const done: ReviewGroup = { ...group, status: 'completed', items: group.items.map((item) => ({ ...item, outcome: 'closed' })) }
    const wrapper = mount(ReviewGroupList, { props: { group: done, preparation: null, currentPrNumber: 8, completedItem: done.items[1]!, autoAdvance: false, offline: false } })
    expect(wrapper.text()).toContain('Round complete. No more PRs in this round.')
    expect(wrapper.findAll('[data-testid="completed-row"]')).toHaveLength(1)
    expect(wrapper.find('.rg-next').exists()).toBe(false)
    expect(wrapper.find('.rg-stay').exists()).toBe(false)
  })
})
