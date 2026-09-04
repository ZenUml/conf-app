import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DrawIoHeader from './DrawIoHeader.vue'

const meta: Meta<typeof DrawIoHeader> = {
  title: 'Layout/DrawIO editor chrome',
  component: DrawIoHeader,
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Graph and Board title states. Board deliberately uses the 28px Sketch-row variant.' } },
  },
}

export default meta
type Story = StoryObj<typeof DrawIoHeader>

export const Graph: Story = {
  args: { title: 'Payment topology', editorMode: 'diagram' },
}

export const Board: Story = {
  args: { title: 'Workshop map', editorMode: 'board' },
}

export const EmptyBoard: Story = {
  args: { title: '', editorMode: 'board', aiTitleAvailable: true },
}

export const TitleError: Story = {
  args: { title: '', editorMode: 'board', error: true },
}
