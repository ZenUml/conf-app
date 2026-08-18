import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import HomepageFeedCard from './HomepageFeedCard.vue'

type Story = StoryObj<typeof HomepageFeedCard>

const meta: Meta<typeof HomepageFeedCard> = {
  title: 'HomepageFeed/HomepageFeedCard',
  component: HomepageFeedCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'confluence:homepageFeed card — renders in the right panel of the Confluence Home page. ' +
          'The only onboarding surface a non-admin end user reaches without first inserting a macro; ' +
          'the confluence:globalSettings "Get Started" page is admin-only. One compact action: a link ' +
          'to the documentation quick-start guide.',
      },
    },
  },
}

export default meta

/**
 * Default render: the card body copy and the single action button are visible.
 */
export const Default: Story = {
  name: 'Default — body copy and one action visible',
  play: async () => {
    const canvas = within(document.body)
    await expect(
      await canvas.findByText(/Turn text into sequence, flowchart, and API diagrams/)
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: /View the quick-start guide/ })
    ).toBeVisible()
  },
}

/**
 * Clicking the action button is a real, clickable affordance (not disabled).
 */
export const ActionClickable: Story = {
  name: 'Action button is clickable',
  play: async () => {
    const canvas = within(document.body)
    const button = canvas.getByRole('button', { name: /View the quick-start guide/ })
    await expect(button).toBeEnabled()
    await userEvent.click(button)
  },
}
