import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import UpgradePrompt from './UpgradePrompt.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { useCustomerSuccessService } from '@/composables/useCustomerSuccessService'

type Story = StoryObj<typeof UpgradePrompt>

function installForgeMocks() {
  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  forgeGlobal.forgeContext = {
    accountId: 'storybook-user',
    siteUrl: 'https://example-tenant.atlassian.net',
    extension: {
      content: { id: 'storybook-page' },
      space: { key: 'STORY' },
    },
  }
}

function installPaywallState() {
  localStorage.setItem('mockClientDomain', 'example-tenant')
  localStorage.setItem('mockSpaceKey', 'STORY')
  localStorage.setItem('mockMacroCount', '105')
  localStorage.setItem('mockCSSEnabled', 'true')
  localStorage.setItem('mockSpacePaid', 'false')
  ;(useCustomerSuccessService as any).__resetForTests?.()
  void useCustomerSuccessService().initialize()
}

function installClipboardMock(shouldCopy: boolean) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: shouldCopy
      ? { writeText: async () => undefined }
      : { writeText: async () => { throw new Error('Storybook clipboard failure') } },
  })
}

function installNavigationMock() {
  window.open = ((url?: string | URL) => {
    console.info('[storybook] open extension request URL', String(url))
    return null
  }) as typeof window.open
}

const meta: Meta<typeof UpgradePrompt> = {
  title: 'Paywall/UpgradePrompt',
  component: UpgradePrompt,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'forgeModal' },
    docs: {
      description: {
        component: 'Lite paywall modal states for support-assisted extension requests.',
      },
    },
  },
  args: {
    visible: true,
    macrosCreated: 105,
    macrosLimit: 100,
    upgradeUrl: 'https://marketplace.example/upgrade?domain=example-tenant',
    enterpriseBundleUrl: 'https://stripe.example/bundle',
    macroKind: 'mermaid',
    actionType: 'page_editor',
  },
  decorators: [
    (_story, context) => {
      installForgeMocks()
      installPaywallState()
      installClipboardMock(context.parameters.extensionRequestCopy !== false)
      installNavigationMock()
      return {
        template: '<div class="min-h-screen bg-slate-100"><story /></div>',
      }
    },
  ],
}

export default meta

export const Default: Story = {}

export const RequestExtensionCopied: Story = {
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByTestId('request-extension-btn'))
    await expect(await body.findByTestId('request-extension-status')).toHaveTextContent(
      /Request details copied/
    )
  },
}

export const RequestExtensionCopyFailed: Story = {
  parameters: {
    extensionRequestCopy: false,
  },
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByTestId('request-extension-btn'))
    await expect(await body.findByTestId('request-extension-status')).toHaveTextContent(
      /Support form opened/
    )
  },
}

export const DraftPreviewExpanded: Story = {
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByTestId('draft-toggle-btn'))
    await expect(await body.findByTestId('advocacy-draft-body')).toBeVisible()
  },
}
