import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import forgeGlobal from '@/model/globals/forgeGlobal'
import TemplateOfferBanner from './TemplateOfferBanner.vue'

const meta: Meta<typeof TemplateOfferBanner> = {
  title: 'Shared/TemplateOfferBanner',
  component: TemplateOfferBanner,
  parameters: { layout: 'fullscreen' },
  decorators: [
    () => {
      localStorage.setItem('mockClientDomain', 'example-tenant')
      localStorage.setItem('mockSpaceKey', 'ENG')
      forgeGlobal.isForge = false
      forgeGlobal.isLite = true
      forgeGlobal.forgeContext = {
        accountId: 'storybook-admin',
        siteUrl: 'https://example-tenant.atlassian.net',
        extension: { space: { key: 'ENG' } },
      }
      return { template: '<story />' }
    },
  ],
}

export default meta
type Story = StoryObj<typeof TemplateOfferBanner>

export const EligibleAdmin: Story = {
  args: { macroCount: 67 },
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByTestId('template-offer-banner')).toHaveTextContent(
      'This space has 67 diagrams.',
    )
    await expect(body.getByTestId('template-offer-create')).toBeVisible()
    await expect(body.getByTestId('template-offer-dismiss')).toBeVisible()
  },
}

export const CreateFailed: Story = {
  args: { macroCount: 67 },
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByTestId('template-offer-create'))
    await expect(await body.findByRole('alert')).toHaveTextContent(
      'ZenUML could not create the template',
    )
  },
}
