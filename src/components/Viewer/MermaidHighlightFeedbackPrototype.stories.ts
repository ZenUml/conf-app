import type { Meta, StoryObj } from '@storybook/vue3-vite'
import MermaidHighlightFeedbackPrototype from './MermaidHighlightFeedbackPrototype.vue'

const meta: Meta<typeof MermaidHighlightFeedbackPrototype> = {
  title: 'Viewer/MermaidHighlightFeedbackPrototype',
  component: MermaidHighlightFeedbackPrototype,
  parameters: { layout: 'fullscreen' },
  argTypes: { initialState: { control: 'select', options: ['interactive', 'prompt', 'liked', 'disliked', 'dismissed'] } },
}
export default meta
type Story = StoryObj<typeof MermaidHighlightFeedbackPrototype>
export const Interactive: Story = { args: { initialState: 'interactive' } }
export const PromptVisible: Story = { args: { initialState: 'prompt' } }
export const Liked: Story = { args: { initialState: 'liked' } }
export const Disliked: Story = { args: { initialState: 'disliked' } }
export const Dismissed: Story = { args: { initialState: 'dismissed' } }
