import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import forgeGlobal from '@/model/globals/forgeGlobal'
import ConnectMcpDialog from './ConnectMcpDialog.vue'
import type { McpClientChoice } from '@/composables/agentLink/connectInstructions'

// The dialog opens on the client tab this browser chose last; each story
// pins it so it renders the same every time.
function onTab(client: McpClientChoice) {
  return () => {
    try {
      localStorage.setItem('zenuml.mcpClientChoice', client)
    } catch {
      // Storage blocked: the dialog falls back to Claude Code.
    }
    forgeGlobal.zenumlRemoteBaseUrl = 'https://conf-lite.zenuml.com'
    // The overlay is bound to a position:relative frame, like .viewer-frame.
    return { template: '<div style="position: relative; height: 620px; background: #f4f5f7;"><story /></div>' }
  }
}

const meta: Meta<typeof ConnectMcpDialog> = {
  title: 'Shared/ConnectMcpDialog',
  component: ConnectMcpDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Connect MCP dialog: what connecting gives, step 1 with one tab per MCP client (the last choice remembered per browser), step 2 the prompt naming this diagram.',
      },
    },
  },
  args: {
    visible: true,
    diagramTitle: 'Checkout flow',
    cloudId: '00000000-0000-4000-8000-000000000000',
    pageId: '123456',
    contentId: '654321',
  },
}
export default meta

type Story = StoryObj<typeof ConnectMcpDialog>

export const ClaudeCode: Story = {
  name: 'Claude Code (default)',
  decorators: [onTab('claude_code')],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByTestId('connect-mcp-setup-command')).toHaveTextContent('claude mcp add --transport http zenuml')
    await expect(body.getByTestId('connect-mcp-lede')).toBeVisible()
  },
}

export const ClaudeApp: Story = {
  name: 'Claude app (web or desktop)',
  decorators: [onTab('claude_app')],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByTestId('connect-mcp-client-steps')).toHaveTextContent('Add custom connector')
    await expect(body.getByTestId('connect-mcp-server-url')).toHaveTextContent('https://conf-lite.zenuml.com/agent-link/mcp')
  },
}

export const Cursor: Story = {
  decorators: [onTab('cursor')],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByTestId('connect-mcp-install')).toHaveTextContent('Add to Cursor')
  },
}

export const Codex: Story = {
  decorators: [onTab('codex')],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByTestId('connect-mcp-setup-command')).toHaveTextContent('codex mcp add zenuml --url https://conf-lite.zenuml.com/agent-link/mcp')
    await expect(body.getByTestId('connect-mcp-codex-login')).toHaveTextContent('codex mcp login zenuml')
  },
}

export const ChatGpt: Story = {
  name: 'ChatGPT',
  decorators: [onTab('chatgpt')],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByTestId('connect-mcp-client-steps')).toHaveTextContent('chatgpt.com/plugins')
    await expect(body.getByTestId('connect-mcp-server-url')).toHaveTextContent('https://conf-lite.zenuml.com/agent-link/mcp')
  },
}

export const VsCode: Story = {
  name: 'VS Code',
  decorators: [onTab('vscode')],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByTestId('connect-mcp-install')).toHaveTextContent('Add to VS Code')
  },
}

export const Other: Story = {
  decorators: [onTab('other')],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByTestId('connect-mcp-install-prompt')).toHaveTextContent('- name: zenuml')
    await expect(body.getByTestId('connect-mcp-server-url')).toHaveTextContent('https://conf-lite.zenuml.com/agent-link/mcp')
  },
}

export const SwitchTabs: Story = {
  name: 'Switching tabs',
  decorators: [onTab('claude_code')],
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByTestId('connect-mcp-tab-claude_app'))
    await expect(body.getByTestId('connect-mcp-tab-claude_app')).toHaveAttribute('aria-selected', 'true')
    await expect(body.queryByTestId('connect-mcp-setup-command')).toBeNull()
  },
}
