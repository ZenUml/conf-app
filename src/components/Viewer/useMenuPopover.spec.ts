import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, it, expect, afterEach } from 'vitest'
import { useMenuPopover } from './useMenuPopover'
import CopyForAiMenu from './CopyForAiMenu.vue'
import OverflowMenu from './OverflowMenu.vue'

const Harness = defineComponent({
  emits: ['opened', 'closed'],
  setup(_p: Record<string, never>, { emit }: { emit: (event: 'opened' | 'closed') => void }) {
    return useMenuPopover(emit)
  },
  template: `
    <div>
      <div ref="containerRef" data-testid="container">
        <button ref="triggerRef" data-testid="trigger" @click="toggle">t</button>
        <div v-if="open" ref="menuRef" role="menu" @keydown="onMenuKeydown">
          <button role="menuitem" data-testid="item-1">a</button>
          <button role="menuitem" data-testid="item-2">b</button>
        </div>
      </div>
      <button data-testid="outside">x</button>
    </div>`,
})

let wrapper: ReturnType<typeof mount> | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

const mountIt = (comp: any, opts: any = {}) =>
  mount(comp, { attachTo: document.body, ...opts })
const flush = () => new Promise(r => setTimeout(r))

type Case = { name: string; make: () => ReturnType<typeof mount>; trigger: string; item: string }
const cases: Case[] = [
  { name: 'useMenuPopover harness', make: () => mountIt(Harness), trigger: '[data-testid="trigger"]', item: '[data-testid="item-1"]' },
  { name: 'OverflowMenu', make: () => mountIt(OverflowMenu, { slots: { default: '<button role="menuitem" data-testid="item-1">a</button>' } }), trigger: '.overflow-menu-trigger', item: '[data-testid="item-1"]' },
  { name: 'CopyForAiMenu', make: () => mountIt(CopyForAiMenu), trigger: '[data-testid="copy-for-ai-menu-btn"]', item: '[data-testid="copy-for-ai-job-explain"]' },
]

describe.each(cases)('menu popover behaviour: $name', ({ make, trigger, item }) => {
  const openIt = async () => {
    wrapper = make()
    await wrapper.find(trigger).trigger('click')
    await flush()
    return wrapper
  }

  it('opens, emits opened once and focuses the first item', async () => {
    const w = await openIt()
    expect(w.find('[role="menu"]').exists()).toBe(true)
    expect(w.emitted('opened')).toHaveLength(1)
    expect(document.activeElement).toBe(w.find(item).element)
  })

  it('closes on click outside without moving focus to the trigger', async () => {
    const w = await openIt()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(w.find('[role="menu"]').exists()).toBe(false)
    expect(w.emitted('closed')).toHaveLength(1)
    expect(document.activeElement).not.toBe(w.find(trigger).element)
  })

  it('does not close on mousedown inside', async () => {
    const w = await openIt()
    w.find('[role="menu"]').element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(w.find('[role="menu"]').exists()).toBe(true)
  })

  it('Escape inside the menu closes and returns focus to the trigger', async () => {
    const w = await openIt()
    await w.find(item).trigger('keydown', { key: 'Escape' })
    expect(w.find('[role="menu"]').exists()).toBe(false)
    expect(w.emitted('closed')).toHaveLength(1)
    expect(document.activeElement).toBe(w.find(trigger).element)
  })

  it('Escape on the document (focus outside menu) closes and refocuses trigger', async () => {
    const w = await openIt()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    expect(w.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(w.find(trigger).element)
  })

  it('Tab closes without returning focus to the trigger', async () => {
    const w = await openIt()
    await w.find(item).trigger('keydown', { key: 'Tab' })
    expect(w.find('[role="menu"]').exists()).toBe(false)
    expect(w.emitted('closed')).toHaveLength(1)
    expect(document.activeElement).not.toBe(w.find(trigger).element)
  })

  it('removes document listeners on unmount', async () => {
    const w = await openIt()
    w.unmount()
    wrapper = undefined
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow()
  })
})

describe('CopyForAiMenu select', () => {
  it('emits select with the job and closes returning focus to the trigger', async () => {
    wrapper = mountIt(CopyForAiMenu)
    await wrapper.find('[data-testid="copy-for-ai-menu-btn"]').trigger('click')
    await flush()
    await wrapper.find('[data-testid="copy-for-ai-job-tests"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['tests']])
    expect(wrapper.emitted('closed')).toHaveLength(1)
    expect(document.activeElement).toBe(wrapper.find('[data-testid="copy-for-ai-menu-btn"]').element)
  })
})
