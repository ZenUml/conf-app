import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ConnectMcpDialog from './ConnectMcpDialog.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'

function mountDialog(props: { visible?: boolean; diagramTitle?: string; cloudId?: string; pageId?: string; contentId?: string } = {}) {
  return mount(ConnectMcpDialog, { props: { visible: true, ...props } })
}

describe('ConnectMcpDialog (headless)', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('renders nothing while hidden', () => {
    const wrapper = mountDialog({ visible: false })
    expect(wrapper.find('[data-testid="connect-mcp-dialog"]').exists()).toBe(false)
  })

  it('shows the setup command, the sign-in note and a prompt naming this diagram', () => {
    forgeGlobal.zenumlRemoteBaseUrl = 'https://conf-lite.zenuml.com'
    const wrapper = mountDialog({ diagramTitle: 'Login flow', cloudId: 'c-1', pageId: '42', contentId: '99' })
    forgeGlobal.zenumlRemoteBaseUrl = undefined
    expect(wrapper.find('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.find('[data-testid="connect-mcp-dialog"]').attributes('data-mcp-mode')).toBe('headless')
    expect(wrapper.find('[data-testid="connect-mcp-setup-command"]').text()).toBe(
      'claude mcp add --transport http zenuml https://conf-lite.zenuml.com/agent-link/mcp'
    )
    expect(wrapper.text()).toContain('URL https://conf-lite.zenuml.com/agent-link/mcp')
    expect(wrapper.text()).toContain('sign in with Atlassian')
    const prompt = wrapper.find('[data-testid="connect-mcp-prompt"]').text()
    expect(prompt).toContain('"Login flow"')
    expect(prompt).toContain('cloudId: c-1')
    expect(prompt).toContain('contentId: 99')
    expect(prompt).not.toContain('session:')
    expect(wrapper.find('[data-testid="connect-mcp-reload-note"]').text()).toContain('Reload the page')
  })

  it('has no session states: no waiting indicator, disconnect or retry', () => {
    const wrapper = mountDialog()
    expect(wrapper.find('[data-testid="connect-mcp-waiting"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="connect-mcp-retry"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="connect-mcp-copy-prompt"]').attributes('disabled')).toBeUndefined()
  })

  it('copies the setup command and the prompt and reports each', async () => {
    const wrapper = mountDialog({ cloudId: 'c-1', contentId: '99' })
    await wrapper.find('[data-testid="connect-mcp-copy-setup"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith(wrapper.find('[data-testid="connect-mcp-setup-command"]').text())
    expect(wrapper.find('[data-testid="connect-mcp-copy-setup"]').text()).toBe('Copied')

    await wrapper.find('[data-testid="connect-mcp-copy-prompt"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('contentId: 99'))
    expect(wrapper.emitted('copy')).toEqual([['setup_command', true], ['prompt', true]])
  })

  it('reports a failed copy and offers manual selection', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const execCommand = vi.fn(() => false)
    Object.assign(document, { execCommand })
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="connect-mcp-copy-prompt"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="connect-mcp-copy-prompt"]').text()).toBe('Select & copy')
    expect(wrapper.emitted('copy')).toEqual([['prompt', false]])
  })

  it.each([
    ['the close button', '[data-testid="connect-mcp-close"]'],
    ['Done', '[data-testid="connect-mcp-done"]'],
    ['the backdrop', '[data-testid="connect-mcp-dialog"]'],
  ])('closes from %s', async (_name, selector) => {
    const wrapper = mountDialog()
    await wrapper.find(selector).trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
