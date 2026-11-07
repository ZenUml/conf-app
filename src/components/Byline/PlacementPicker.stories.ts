import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import PlacementPicker from './PlacementPicker.vue'
import { PLACEMENT_PAGE_CONTENT } from './fixtures/placementPage'

type Story = StoryObj<typeof PlacementPicker>

const pageWith = (content: unknown[]) => async () => ({
  status: 'ok' as const,
  title: 'Payment service design',
  version: 7,
  content,
})

const meta: Meta<typeof PlacementPicker> = {
  title: 'Modal/PlacementPicker',
  component: PlacementPicker,
  parameters: { layout: 'fullscreen' },
  args: {
    pageId: 'page-1',
    diagram: { id: 'cc-2', title: 'Checkout flow', diagramType: 'sequence' },
    surface: 'byline',
    onChoose: fn(),
    onDismiss: fn(),
    loadPage: pageWith(PLACEMENT_PAGE_CONTENT),
  },
}

export default meta

export const DefaultEndOfPage: Story = {}

export const ChooseASpot: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const gaps = await canvas.findAllByTestId('placement-gap')
    await userEvent.click(gaps[3])
    await expect(canvas.getByTestId('placement-where')).toHaveTextContent('After the table')
    await userEvent.click(canvas.getByTestId('placement-confirm'))
    await expect(args.onChoose).toHaveBeenCalled()
  },
}

export const EmptyPage: Story = { args: { loadPage: pageWith([]) } }

export const ReadFailed: Story = { args: { loadPage: async () => ({ status: 'failed' as const }) } }
