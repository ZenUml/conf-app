import type { Meta, StoryObj } from '@storybook/vue3-vite'
import McpPromoCard from './McpPromoCard.vue'

const meta: Meta<typeof McpPromoCard> = {
  title: 'Shared/McpPromoCard',
  component: McpPromoCard,
  parameters: {
    docs: {
      description: {
        component:
          'One-action promo for the Connect MCP dialog. `card` floats over a diagram (Fullscreen viewer, editor new-diagram); `tip` is the dark variant docked in the editor code pane. Display rules live in mcpPromo.ts.',
      },
    },
  },
}
export default meta

type Story = StoryObj<typeof McpPromoCard>

export const Card: Story = {
  args: {
    variant: 'card',
    title: 'Draw diagrams from your AI tools',
    body: 'Create and update diagrams from Claude, Cursor or VS Code — using your code as the source.',
  },
}

export const NewDiagram: Story = {
  args: {
    variant: 'card',
    title: 'Start from your code',
    body: 'Let Claude, Cursor or VS Code draft this diagram from your codebase, then paste it here.',
    ctaLabel: 'Generate with AI (MCP)',
  },
}

export const Tip: Story = {
  args: {
    variant: 'tip',
    title: 'Skip the typing — let Claude or Cursor write this diagram from your code.',
  },
  decorators: [() => ({ template: '<div style="width: 420px; padding: 12px; background: #282A36;"><story /></div>' })],
}
