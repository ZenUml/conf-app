import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentPanel from './AgentPanel.vue'
import { MESSAGES, PR_888, PREFS, REVIEWS, TASK_DONE, TASK_WORKING } from '../preview/fixtures'
import type { PanelConnection, PanelPrefsView } from './types'

function mountPanel(over: Partial<{ connection: PanelConnection; prefs: PanelPrefsView; [k: string]: unknown }> = {}) {
  return mount(AgentPanel, {
    props: { connection: 'active', pr: PR_888, prState: 'draft', review: REVIEWS[2], prefs: PREFS, ...over } as never,
    attachTo: document.body,
  })
}
const badge = (w: ReturnType<typeof mountPanel>) => w.get('[data-testid="mcp-badge"]')

describe('AgentPanel connection states', () => {
  it('01 server not running: dashed neutral badge, grey dot, "not running" title', () => {
    const w = mountPanel({ connection: 'off' })
    const c = badge(w).classes()
    expect(c).toEqual(expect.arrayContaining(['tp-badge', 'tp-mcp-badge', 'tp-badge-neutral', 'tp-badge-dashed', 'tp-mcp-badge-disconnected']))
    expect(c).not.toContain('tp-mcp-badge-inactive')
    expect(c).not.toContain('tp-mcp-badge-active')
    expect(badge(w).attributes('title')).toBe('MCP server is not running')
    expect(w.get('[data-testid="message-input"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('says MCP access is disabled when the user has not opted in', () => {
    const w = mountPanel({ connection: 'off', prefs: { ...PREFS, mcpAccess: 'disabled' } })
    expect(badge(w).attributes('title')).toBe('MCP access is disabled')
    expect(badge(w).classes()).toContain('tp-badge-dashed')
    w.unmount()
  })

  it('02 another tab active: dashed badge with pulsing dot; click emits activate', async () => {
    const w = mountPanel({ connection: 'inactive' })
    const c = badge(w).classes()
    expect(c).toEqual(expect.arrayContaining(['tp-badge-neutral', 'tp-badge-dashed', 'tp-mcp-badge-connected', 'tp-mcp-badge-inactive']))
    expect(badge(w).attributes('title')).toBe('Inactive\nClick to activate')
    await badge(w).trigger('click')
    expect(w.emitted('activate')).toHaveLength(1)
    w.unmount()
  })

  it('03 this tab active: solid success badge; click does nothing', async () => {
    const w = mountPanel({ connection: 'active' })
    const c = badge(w).classes()
    expect(c).toEqual(expect.arrayContaining(['tp-badge-success', 'tp-badge-solid', 'tp-mcp-badge-connected', 'tp-mcp-badge-active']))
    expect(c).not.toContain('tp-badge-dashed')
    expect(badge(w).attributes('title')).toBe('Active')
    await badge(w).trigger('click')
    expect(w.emitted('activate')).toBeUndefined()
    expect(w.find('[data-testid="task-row"]').exists()).toBe(false)
    w.unmount()
  })

  it('04 agent working: shimmer label and Stop emits the task id', async () => {
    const w = mountPanel({ task: TASK_WORKING })
    const label = w.get('[data-testid="task-label"]')
    expect(label.text()).toBe('Claude Code is reviewing #888')
    expect(label.classes()).toContain('tp-design-shimmer')
    expect(w.get('.tp-design-logo').classes()).toContain('tp-logo-loading')
    const action = w.get('[data-testid="task-action"]')
    expect(action.text()).toBe('Stop')
    expect(action.classes()).toContain('tp-design-stop')
    await action.trigger('click')
    expect(w.emitted('stop')).toEqual([['t1']])
    w.unmount()
  })

  it('05 task finished: plain label and Done emits the task id', async () => {
    const w = mountPanel({ task: TASK_DONE })
    const label = w.get('[data-testid="task-label"]')
    expect(label.text()).toBe('Claude Code finished the review')
    expect(label.classes()).not.toContain('tp-design-shimmer')
    const action = w.get('[data-testid="task-action"]')
    expect(action.text()).toBe('Done')
    expect(action.classes()).toContain('tp-design-done')
    await action.trigger('click')
    expect(w.emitted('done')).toEqual([['t1']])
    w.unmount()
  })
})

describe('AgentPanel layout states', () => {
  it('06 collapsed: header only, plus button, no preferences button; toggle emits', async () => {
    const w = mountPanel({ prefs: { ...PREFS, panelCollapsed: true } })
    expect(w.get('.tp-panel').classes()).toContain('tp-panel-minimized')
    expect(w.find('.tp-panel-main').exists()).toBe(false)
    expect(w.find('[data-testid="prefs-button"]').exists()).toBe(false)
    const btn = w.get('[data-testid="collapse-button"]')
    expect(btn.attributes('aria-label')).toBe('Expand')
    expect(btn.html()).toContain('M12 6.5v11M6.5 12h11') // PLUS
    await btn.trigger('click')
    expect(w.emitted('toggleCollapsed')).toHaveLength(1)
    w.unmount()
  })

  it('double-clicking the header toggles collapse; double-clicking a header button does not', async () => {
    const w = mountPanel()
    await w.get('.tp-panel-header').trigger('dblclick')
    expect(w.emitted('toggleCollapsed')).toHaveLength(1)
    await w.get('[data-testid="mcp-badge"]').trigger('dblclick')
    expect(w.emitted('toggleCollapsed')).toHaveLength(1)
    w.unmount()
  })

  it('expanded shows the Agent integration preferences; its controls emit', async () => {
    const w = mountPanel({ prefs: { ...PREFS, mcpAccess: 'disabled' } })
    expect(w.get('[data-testid="prefs-button"]').classes()).toContain('tp-button-selected')
    expect(w.get('[data-testid="prefs-section"]').text()).toContain('Agent integration')
    expect(w.get('[data-testid="prefs-section"]').text()).toContain('MCP access')
    expect(w.text()).not.toContain('Tools')
    await w.get('[data-testid="mcp-on"]').setValue(true)
    expect(w.emitted('setMcpAccess')).toEqual([['enabled']])
    // The prop did not change (permission missing): the radios snap back to Disabled.
    await new Promise((r) => setTimeout(r, 0))
    expect((w.get('[data-testid="mcp-on"]').element as HTMLInputElement).checked).toBe(false)
    expect((w.get('[data-testid="mcp-off"]').element as HTMLInputElement).checked).toBe(true)
    await w.get('[data-testid="setup-agents"]').trigger('click')
    expect(w.emitted('openOptions')).toHaveLength(1)
    await w.get('[data-testid="prefs-button"]').trigger('click')
    expect(w.emitted('togglePrefs')).toHaveLength(1)
    w.unmount()
  })

  it('07 preferences hidden: prefs section gone, PR / review / messages stay', () => {
    const w = mountPanel({ prefs: { ...PREFS, preferencesHidden: true } })
    expect(w.find('[data-testid="prefs-section"]').exists()).toBe(false)
    expect(w.get('[data-testid="prefs-button"]').classes()).not.toContain('tp-button-selected')
    expect(w.get('[data-testid="pr-label"]').text()).toBe(`#888 · ${PR_888.title}`)
    expect(w.find('[data-testid="review-section"]').exists()).toBe(true)
    expect(w.find('[data-testid="messages-section"]').exists()).toBe(true)
    w.unmount()
  })

  it('08 no pull request: compact panel with "No pull request" only', () => {
    const w = mountPanel({ pr: null, review: null, prefs: { ...PREFS, preferencesHidden: true } })
    expect(w.get('[data-testid="meta-row"]').text()).toBe('No pull request')
    expect(w.find('[data-testid="review-section"]').exists()).toBe(false)
    expect(w.find('[data-testid="messages-section"]').exists()).toBe(false)
    w.unmount()
  })
})

describe('AgentPanel sections', () => {
  it('meta row shows the PR state badge', () => {
    const w = mountPanel({ prState: 'merged' })
    const b = w.get('[data-testid="meta-row"] .tp-badge')
    expect(b.text()).toBe('Merged')
    expect(b.classes()).toEqual(expect.arrayContaining(['tp-badge-brand', 'tp-badge-solid']))
    w.unmount()
  })

  it('review section shows headline, priority, findings and the stale marker; "No review yet" otherwise', () => {
    const w = mountPanel({ findingsCount: 3 })
    const text = w.get('[data-testid="review-section"]').text()
    expect(text).toContain(REVIEWS[2]!.headline)
    expect(text).toContain('P1')
    expect(text).toContain('3 findings')
    expect(text).toContain('PR updated')
    w.unmount()
    const empty = mountPanel({ review: null })
    expect(empty.get('[data-testid="review-section"]').text()).toContain('No review yet')
    empty.unmount()
  })

  it('renders agent messages and queued / delivered markers on user messages', () => {
    const w = mountPanel({ messages: MESSAGES })
    const rows = w.findAll('[data-testid="message"]')
    expect(rows).toHaveLength(4)
    expect(rows[1]!.classes()).toContain('tp-message-agent')
    expect(w.findAll('[data-testid="message-status"]').map((s) => s.text())).toEqual(['queued', 'delivered'])
    w.unmount()
    const waiting = mountPanel({ messages: [{ id: 'u', role: 'user', text: 'hi', status: 'queued', waitingForAgent: true }] })
    expect(waiting.get('[data-testid="message-status"]').text()).toBe("queued, delivered on the agent's next turn")
    waiting.unmount()
  })

  it('Send emits the trimmed text and clears the box; Enter sends, empty text does not', async () => {
    const w = mountPanel()
    const input = w.get('[data-testid="message-input"]')
    const send = w.get('[data-testid="send-button"]')
    expect(send.attributes('disabled')).toBeDefined()
    await input.setValue('   please re-check the paging   ')
    await send.trigger('click')
    expect(w.emitted('send')).toEqual([['please re-check the paging']])
    expect((input.element as HTMLTextAreaElement).value).toBe('')

    await input.setValue('   ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('send')).toHaveLength(1)

    await input.setValue('second')
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('send')).toEqual([['please re-check the paging'], ['second']])
    w.unmount()
  })

  it('double-clicking a resize edge resets the width to 240 and emits resize', async () => {
    const w = mountPanel({ prefs: { ...PREFS, panelWidth: 400 } })
    expect((w.get('.tp-panel').element as HTMLElement).style.width).toBe('400px')
    await w.get('.tp-panel-resize-handle-left').trigger('dblclick')
    expect((w.get('.tp-panel').element as HTMLElement).style.width).toBe('240px')
    expect(w.emitted('resize')).toEqual([[240]])
    w.unmount()
  })
})
