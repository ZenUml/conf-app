import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, within } from 'storybook/test'
import GetStarted from './GetStarted.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'

type Story = StoryObj<typeof GetStarted>

/**
 * Stub out Forge-specific side-effects so Storybook renders cleanly:
 *  - forgeGlobal.isForge = false disables AP/bridge calls in openUrl
 *  - mockClientDomain lets getLocalStorageKey() produce stable keys for analytics
 */
function installMocks() {
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
  localStorage.setItem('mockClientDomain', 'example-tenant')
}

const meta: Meta<typeof GetStarted> = {
  title: 'Onboarding/GetStarted',
  component: GetStarted,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Post-install onboarding screen shown to admins (Forge useAsGetStarted). Its primary control ' +
          'creates a real examples page (via the shared createDemoPage resolver/pipeline) in an ' +
          'admin-chosen space, plus a compact resources panel. Fires get_started_viewed on mount and ' +
          'get_started_action_clicked on every control click.',
      },
    },
  },
  decorators: [
    () => {
      installMocks()
      return {
        template: '<div style="background:#F4F5F7;min-height:100vh;"><story /></div>',
      }
    },
  ],
}

export default meta

/**
 * Full page render — hero, the create-examples-page action, and the
 * resources panel.
 */
export const Default: Story = {
  name: 'Default — full page',
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText(/Welcome to ZenUML Diagrams!/)).toBeVisible()
    await expect(canvas.getByText('Create an examples page')).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Create examples page/ })).toBeVisible()
    await expect(canvas.getByText('Resources & Support')).toBeVisible()
  },
}

/**
 * The primary action: pick a space, create the examples page. Disabled until
 * a space key is entered — never fires without an explicit click.
 */
export const CreateExamplesPageAction: Story = {
  name: 'Action — create examples page',
  play: async () => {
    const canvas = within(document.body)
    const button = await canvas.findByRole('button', { name: /Create examples page/ })
    await expect(button).toBeDisabled()
    const input = canvas.getByLabelText('Space key')
    await expect(input).toBeVisible()
  },
}

/**
 * Resources section — documentation, videos, community, and issue reporting
 * links. Real hrefs (not "#") so middle-click and copy-link work; openUrl()
 * still handles the click for the Forge iframe.
 */
export const ResourceLinks: Story = {
  name: 'Resources — support links',
  play: async () => {
    const canvas = within(document.body)
    const docsLink = await canvas.findByRole('link', { name: /View Documentation/ })
    await expect(docsLink).toBeVisible()
    await expect(docsLink).toHaveAttribute('href', expect.stringContaining('http'))
    await expect(canvas.getByRole('link', { name: /Watch Videos/ })).toBeVisible()
    await expect(canvas.getByRole('link', { name: /Join Community/ })).toBeVisible()
    await expect(canvas.getByRole('link', { name: /Report Issue/ })).toBeVisible()
  },
}
