import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ConnectMcpDialog from './ConnectMcpDialog.vue'
import forgeGlobal, { openUrl } from '@/model/globals/forgeGlobal'

vi.mock('@/model/globals/forgeGlobal', async (orig) => ({
  ...(await orig<typeof import('@/model/globals/forgeGlobal')>()),
  openUrl: vi.fn(() => Promise.resolve()),
}))

function mountDialog(props: { visible?: boolean; diagramTitle?: string; cloudId?: string; pageId?: string; contentId?: string } = {}) {
  return mount(ConnectMcpDialog, { props: { visible: true, ...props } })
}

describe('ConnectMcpDialog (headless)', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    localStorage.clear()
    vi.mocked(openUrl).mockClear()
  })

  it('renders nothing while hidden', () => {
    const wrapper = mountDialog({ visible: false })
    expect(wrapper.find('[data-testid="connect-mcp-dialog"]').exists()).toBe(false)
  })

  it('shows the setup command, the sign-in note and a review prompt naming this diagram', () => {
    forgeGlobal.zenumlRemoteBaseUrl = 'https://conf-lite.zenuml.com'
    const wrapper = mountDialog({ diagramTitle: 'Login flow', cloudId: 'c-1', pageId: '42', contentId: '99' })
    forgeGlobal.zenumlRemoteBaseUrl = undefined
    expect(wrapper.find('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.find('[data-testid="connect-mcp-dialog"]').attributes('data-mcp-mode')).toBe('headless')
    expect(wrapper.find('[data-testid="connect-mcp-setup-command"]').text()).toBe(
      'claude mcp add --transport http zenuml https://conf-lite.zenuml.com/agent-link/mcp'
    )
    // Claude Code is the default tab, and the dialog says what connecting gives.
    expect(wrapper.find('[data-testid="connect-mcp-tab-claude_code"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[data-testid="connect-mcp-lede"]').text()).toContain('update it from your codebase')
    expect(wrapper.text()).toContain('sign in with Atlassian')
    const prompt = wrapper.find('[data-testid="connect-mcp-prompt"]').text()
    expect(prompt).toContain('"Login flow"')
    expect(prompt).toContain('cloudId: c-1')
    expect(prompt).toContain('contentId: 99')
    expect(prompt).toContain('review my ZenUML diagram')
    expect(prompt).toContain('wait for my go-ahead before changing it')
    expect(prompt).not.toContain('session:')
    // The reload footer is gone.
    expect(wrapper.find('[data-testid="connect-mcp-reload-note"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Reload the page')
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
    expect(wrapper.emitted('copy')).toEqual([['setup_command', true, 'claude_code'], ['prompt', true, 'claude_code']])
  })

  it('reports a failed copy and offers manual selection', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const execCommand = vi.fn(() => false)
    Object.assign(document, { execCommand })
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="connect-mcp-copy-prompt"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="connect-mcp-copy-prompt"]').text()).toBe('Select & copy')
    expect(wrapper.emitted('copy')).toEqual([['prompt', false, 'claude_code']])
  })

  it.each([
    ['the close button', '[data-testid="connect-mcp-close"]', 'close_button'],
    ['Done', '[data-testid="connect-mcp-done"]', 'done'],
    ['the backdrop', '[data-testid="connect-mcp-dialog"]', 'backdrop'],
  ])('closes from %s', async (_name, selector, source) => {
    const wrapper = mountDialog()
    await wrapper.find(selector).trigger('click')
    expect(wrapper.emitted('close')).toEqual([[source]])
  })

  it('reports leaving the page with the dialog open, and stops listening once it closes', async () => {
    const wrapper = mountDialog()
    window.dispatchEvent(new Event('pagehide'))
    expect(wrapper.emitted('close')).toEqual([['page_hidden']])
    await wrapper.setProps({ visible: false })
    window.dispatchEvent(new Event('pagehide'))
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('ConnectMcpDialog client tabs', () => {
  const URL = 'https://conf-lite.zenuml.com/agent-link/mcp'

  beforeEach(() => {
    localStorage.clear()
    forgeGlobal.zenumlRemoteBaseUrl = 'https://conf-lite.zenuml.com'
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    vi.mocked(openUrl).mockClear()
  })

  it('shows the server URL with the custom-connector steps for the Claude app', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="connect-mcp-tab-claude_app"]').trigger('click')
    expect(wrapper.find('[data-testid="connect-mcp-setup-command"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="connect-mcp-server-url"]').text()).toBe(URL)
    expect(wrapper.find('[data-testid="connect-mcp-client-steps"]').text()).toContain('Add custom connector')
    expect(wrapper.emitted('select-client')).toEqual([['claude_app']])

    await wrapper.find('[data-testid="connect-mcp-copy-url"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('copy')).toEqual([['server_url', true, 'claude_app']])
  })

  it('opens the Cursor install page, with the server config base64-encoded', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="connect-mcp-tab-cursor"]').trigger('click')
    await wrapper.find('[data-testid="connect-mcp-install"]').trigger('click')
    expect(wrapper.emitted('install')).toEqual([['cursor']])
    const link = new globalThis.URL(vi.mocked(openUrl).mock.calls[0][0])
    expect(link.origin + link.pathname).toBe('https://cursor.com/install-mcp')
    expect(link.searchParams.get('name')).toBe('zenuml')
    expect(JSON.parse(atob(link.searchParams.get('config') ?? ''))).toEqual({ url: URL })
  })

  it('opens the VS Code install link through the vscode.dev redirect', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="connect-mcp-tab-vscode"]').trigger('click')
    await wrapper.find('[data-testid="connect-mcp-install"]').trigger('click')
    const link = new globalThis.URL(vi.mocked(openUrl).mock.calls[0][0])
    expect(link.origin).toBe('https://vscode.dev')
    const inner = link.searchParams.get('url') ?? ''
    expect(inner.startsWith('vscode:mcp/install?')).toBe(true)
    expect(JSON.parse(decodeURIComponent(inner.slice('vscode:mcp/install?'.length)))).toEqual({ name: 'zenuml', type: 'http', url: URL })
  })

  it('names the server for other clients', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="connect-mcp-tab-other"]').trigger('click')
    expect(wrapper.find('[data-testid="connect-mcp-client-steps"]').text()).toContain('named zenuml')
    expect(wrapper.find('[data-testid="connect-mcp-install"]').exists()).toBe(false)
  })

  it('remembers the last client and opens on it next time', async () => {
    const first = mountDialog()
    await first.find('[data-testid="connect-mcp-tab-cursor"]').trigger('click')
    first.unmount()
    const second = mountDialog()
    expect(second.find('[data-testid="connect-mcp-tab-cursor"]').attributes('aria-selected')).toBe('true')
    expect(second.find('[data-testid="connect-mcp-client-panel"]').attributes('data-client')).toBe('cursor')
  })

  it('moves between tabs with the arrow keys', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="connect-mcp-tab-claude_code"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('select-client')).toEqual([['other']])
  })
})
