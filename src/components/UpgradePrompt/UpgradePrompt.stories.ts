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

export const DefaultUnlimitedContinue: Story = {
  name: 'Default - Continue still unlimited',
}

export const AttemptsAvailable15: Story = {
  name: 'Phase 2 - 15 attempts available',
  args: {
    remainingContinueAttempts: 15,
  },
  play: async () => {
    const body = within(document.body)
    const button = await body.findByTestId('continue-editing-btn')
    await expect(button).toHaveTextContent('Continue editing without upgrading (15)')
    await expect(button).toHaveAttribute(
      'title',
      'You have 15 temporary continue attempts left before editing is blocked for you in this space.'
    )
  },
}

export const AttemptsLow3: Story = {
  name: 'Phase 2 - low attempts',
  args: {
    remainingContinueAttempts: 3,
  },
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByTestId('continue-editing-btn')).toHaveTextContent(
      'Continue editing without upgrading (3)'
    )
  },
}

export const LastAttempt: Story = {
  name: 'Phase 2 - last attempt',
  args: {
    remainingContinueAttempts: 1,
  },
  play: async () => {
    const body = within(document.body)
    const button = await body.findByTestId('continue-editing-btn')
    await expect(button).toHaveTextContent('Continue editing without upgrading (1)')
    await expect(button).toHaveAttribute(
      'title',
      'You have 1 temporary continue attempt left before editing is blocked for you in this space.'
    )
  },
}

export const AttemptsExhausted: Story = {
  name: 'Phase 2 - attempts exhausted',
  args: {
    remainingContinueAttempts: 0,
  },
  play: async () => {
    const body = within(document.body)
    const exhaustedCopy = await body.findByTestId('continue-attempts-exhausted')
    await expect(exhaustedCopy).toHaveTextContent('Request extension to continue editing')
    await expect(exhaustedCopy).toHaveAttribute(
      'title',
      'No continue attempts remain. Request an extension or upgrade to keep editing.'
    )
    await expect(await body.findByTestId('request-extension-btn')).toBeVisible()
    await expect(await body.findByTestId('advocacy-copy-btn')).toBeVisible()
    await expect(body.queryByTestId('continue-editing-btn')).toBeNull()
  },
}

export const RequestExtensionCopied: Story = {
  args: {
    remainingContinueAttempts: 15,
  },
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByTestId('request-extension-btn'))
    await expect(await body.findByTestId('request-extension-status')).toHaveTextContent(
      /Request details copied/
    )
  },
}

export const RequestExtensionCopyFailed: Story = {
  args: {
    remainingContinueAttempts: 15,
  },
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
  args: {
    remainingContinueAttempts: 15,
  },
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByTestId('draft-toggle-btn'))
    await expect(await body.findByTestId('advocacy-draft-body')).toBeVisible()
  },
}
