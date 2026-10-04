import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ConnectMcpDialog from './ConnectMcpDialog.vue'
import type { AgentLinkClientState } from '@/composables/agentLink/agentLinkState'

function mountDialog(props: { state: AgentLinkClientState; token?: string | null; visible?: boolean; diagramTitle?: string }) {
  return mount(ConnectMcpDialog, { props: { visible: true, token: null, ...props } })
}

describe('ConnectMcpDialog', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('renders nothing while hidden', () => {
    const wrapper = mountDialog({ state: 'waiting', visible: false })
    expect(wrapper.find('[data-testid="connect-mcp-dialog"]').exists()).toBe(false)
  })

  it('shows the setup command and the session prompt while waiting', () => {
    const wrapper = mountDialog({ state: 'waiting', token: 'CL-7F3K-Q9M2' })
    expect(wrapper.find('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.find('[data-testid="connect-mcp-setup-command"]').text()).toBe(
      'claude mcp add --transport http conf-agent https://zenapi.zenuml.com/agent-link/mcp'
    )
    const prompt = wrapper.find('[data-testid="connect-mcp-prompt"]').text()
    expect(prompt).toContain('Connect to my ZenUML diagram via the conf-agent MCP.')
    expect(prompt).toContain('session: CL-7F3K-Q9M2')
    expect(wrapper.find('[data-testid="connect-mcp-waiting"]').text()).toContain('Waiting for your agent')
  })

  it('does not offer the local pending placeholder as a session prompt', () => {
    const wrapper = mountDialog({ state: 'waiting', token: 'pending-1700000000000' })
    expect(wrapper.find('[data-testid="connect-mcp-prompt"]').text()).not.toContain('pending-')
    expect(wrapper.find('[data-testid="connect-mcp-copy-prompt"]').attributes('disabled')).toBeDefined()
  })

  it('nudges setup again after the setup timeout', () => {
    const wrapper = mountDialog({ state: 'timeout', token: 'CL-7F3K-Q9M2' })
    expect(wrapper.find('[data-testid="connect-mcp-waiting"]').text()).toContain('No agent yet')
    expect(wrapper.find('[data-testid="connect-mcp-prompt"]').text()).toContain('session: CL-7F3K-Q9M2')
  })

  it.each([
    ['setup_command', 'connect-mcp-copy-setup', 'claude mcp add'],
    ['prompt', 'connect-mcp-copy-prompt', 'session: CL-7F3K-Q9M2'],
  ] as const)('copies the %s and reports it', async (target, testId, expected) => {
    const wrapper = mountDialog({ state: 'waiting', token: 'CL-7F3K-Q9M2' })
    await wrapper.find(`[data-testid="${testId}"]`).trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(expected))
    expect(wrapper.emitted('copy')).toEqual([[target, true]])
    expect(wrapper.find(`[data-testid="${testId}"]`).text()).toBe('Copied')
  })

  it('reports a failed copy when no clipboard path works', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    ;(document as any).execCommand = vi.fn(() => false)
    const wrapper = mountDialog({ state: 'waiting', token: 'CL-7F3K-Q9M2' })
    await wrapper.find('[data-testid="connect-mcp-copy-prompt"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('copy')).toEqual([['prompt', false]])
    expect(wrapper.find('[data-testid="connect-mcp-copy-prompt"]').text()).toBe('Select & copy')
    delete (document as any).execCommand
  })

  it('confirms the connection and offers Disconnect once the agent pairs', async () => {
    const wrapper = mountDialog({ state: 'connected', token: 'CL-7F3K-Q9M2', diagramTitle: 'Checkout flow' })
    expect(wrapper.find('[data-testid="connect-mcp-connected"]').text()).toContain('Your agent is connected')
    expect(wrapper.text()).toContain('Checkout flow')
    expect(wrapper.find('[data-testid="connect-mcp-prompt"]').exists()).toBe(false)
    await wrapper.find('[data-testid="agent-link-disconnect-btn"]').trigger('click')
    expect(wrapper.emitted('disconnect')).toHaveLength(1)
  })

  it.each(['closed', 'expired', 'failed', 'already_linked'] as const)('offers a new session from %s', async (state) => {
    const wrapper = mountDialog({ state })
    expect(wrapper.find('[data-testid="connect-mcp-ended"]').exists()).toBe(true)
    await wrapper.find('[data-testid="connect-mcp-retry"]').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('closes from the close button and from the backdrop, not from a click inside', async () => {
    const wrapper = mountDialog({ state: 'waiting', token: 'CL-7F3K-Q9M2' })
    await wrapper.find('.connect-mcp-dialog').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.find('[data-testid="connect-mcp-close"]').trigger('click')
    await wrapper.find('[data-testid="connect-mcp-dialog"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })
})
