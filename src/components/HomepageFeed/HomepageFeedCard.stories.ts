import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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
          'confluence:homepageFeed card — renders in the right panel of the Confluence Home page, ' +
          'in an iframe that is exactly 266px wide. The only onboarding surface a non-admin end user ' +
          'reaches without first inserting a macro; the confluence:globalSettings "Get Started" page ' +
          'is admin-only. One list in every state: up to three of the viewer\'s own diagrams (each row ' +
          'navigates to the page carrying it), then example rows for the diagram types they have no ' +
          'diagram of, until the list holds four. An example row opens its picture in place rather ' +
          'than navigating, because nothing on the Home page can create a diagram.',
      },
    },
  },
  decorators: [
    // The card is never wider than its Forge iframe. A story rendered at
    // browser width would hide every truncation and wrapping decision.
    () => ({
      template:
        '<div style="width:266px;border:1px dashed #DFE1E6;padding:0"><story /></div>',
    }),
  ],
}

export default meta

/**
 * Storybook renders outside Forge, so the Confluence search never resolves and
 * the card settles on a full set of example rows — the state a viewer with no
 * diagrams of their own sees.
 */
export const Default: Story = {
  name: 'No diagrams — four example rows',
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText('Examples')).toBeVisible()
    for (const type of ['Flowchart', 'Graph', 'Sequence', 'OpenAPI']) {
      await expect(await canvas.findByText(type)).toBeVisible()
    }
    await expect(
      canvas.getByRole('button', { name: /View the quick-start guide/ })
    ).toBeVisible()
  },
}

/**
 * The action is present from the first frame, including while the diagram
 * lookup is still running: it must not appear late and push the list under the
 * pointer.
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

/**
 * An example row opens in place. One row at a time, and the image is bound only
 * once its row has been opened.
 */
export const ExampleOpensInPlace: Story = {
  name: 'Example row opens in place, one at a time',
  play: async () => {
    const canvas = within(document.body)

    const graph = await canvas.findByRole('button', { name: /Graph/ })
    await expect(graph).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(graph)
    await waitFor(async () => {
      await expect(graph).toHaveAttribute('aria-expanded', 'true')
    })
    await expect(
      await canvas.findByAltText('Graph example')
    ).toBeInTheDocument()

    // Opening a second row closes the first.
    const sequence = await canvas.findByRole('button', { name: /Sequence/ })
    await userEvent.click(sequence)
    await waitFor(async () => {
      await expect(sequence).toHaveAttribute('aria-expanded', 'true')
      await expect(graph).toHaveAttribute('aria-expanded', 'false')
    })

    // Clicking the open row closes it.
    await userEvent.click(sequence)
    await waitFor(async () => {
      await expect(sequence).toHaveAttribute('aria-expanded', 'false')
    })
  },
}
