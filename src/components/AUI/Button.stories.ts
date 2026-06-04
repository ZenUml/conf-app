import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import Button from './Button.vue'

type Story = StoryObj<typeof Button>

const meta: Meta<typeof Button> = {
  title: 'Atoms/AUI/Button',
  component: Button,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'AUI-styled button with four appearance variants (default, primary, warning, danger) and a disabled state. Text color and background are automatically adjusted per variant.',
      },
    },
  },
  argTypes: {
    type: {
      control: { type: 'select' },
      options: ['default', 'primary', 'warning', 'danger'],
      description: 'Visual appearance variant',
    },
    disabled: {
      control: 'boolean',
      description: 'When true, the button is non-interactive and rendered in a muted style',
    },
  },
  args: {
    type: 'default',
    disabled: false,
  },
}

export default meta

/** The base button with no explicit variant — muted grey background, dark text. */
export const Default: Story = {
  args: {
    type: 'default',
  },
  render: (args: Args) => ({
    components: { Button },
    setup() {
      return { args }
    },
    template: '<Button v-bind="args">Click me</Button>',
  }),
}

/** Primary action — Atlassian blue background, white text. */
export const Primary: Story = {
  args: {
    type: 'primary',
  },
  render: (args: Args) => ({
    components: { Button },
    setup() {
      return { args }
    },
    template: '<Button v-bind="args">Save</Button>',
  }),
}

/** Warning — amber background, dark text. Use for potentially destructive but reversible actions. */
export const Warning: Story = {
  args: {
    type: 'warning',
  },
  render: (args: Args) => ({
    components: { Button },
    setup() {
      return { args }
    },
    template: '<Button v-bind="args">Reset</Button>',
  }),
}

/** Danger — red background, white text. Use for destructive or irreversible actions. */
export const Danger: Story = {
  args: {
    type: 'danger',
  },
  render: (args: Args) => ({
    components: { Button },
    setup() {
      return { args }
    },
    template: '<Button v-bind="args">Delete</Button>',
  }),
}

/** Disabled state — any variant can be disabled; background and text both shift to muted values. */
export const Disabled: Story = {
  args: {
    type: 'primary',
    disabled: true,
  },
  render: (args: Args) => ({
    components: { Button },
    setup() {
      return { args }
    },
    template: '<Button v-bind="args">Unavailable</Button>',
  }),
}

/** All four variants side-by-side for a quick visual comparison. */
export const AllVariants: Story = {
  render: () => ({
    components: { Button },
    template: `
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <Button type="default">Default</Button>
        <Button type="primary">Primary</Button>
        <Button type="warning">Warning</Button>
        <Button type="danger">Danger</Button>
        <Button type="primary" :disabled="true">Disabled</Button>
      </div>
    `,
  }),
}
