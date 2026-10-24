import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import PublishButton from './PublishButton.vue'

type Story = StoryObj<typeof PublishButton>

const meta: Meta<typeof PublishButton> = {
  title: 'Shared/PublishButton',
  component: PublishButton,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Publish button used by the diagram editor Header and by the embed editor\'s DocumentList. Props: saveAndExit (click handler), disabled, and loading (spinner plus "Publishing…" label, disabled while the save is in flight).',
      },
    },
  },
  argTypes: {
    saveAndExit: {
      action: 'saveAndExit',
      description: 'Callback invoked when the button is clicked',
    },
    disabled: {
      control: 'boolean',
      description: 'When true the button is greyed out and non-interactive',
    },
    loading: {
      control: 'boolean',
      description: 'When true the button shows a spinner + "Publishing…" and is disabled while the save is in flight',
    },
  },
}

export default meta

/** Idle — ready to publish. Clicking fires the `saveAndExit` action. */
export const Idle: Story = {
  args: {
    disabled: false,
  },
  render: (args: Args) => ({
    components: { PublishButton },
    setup() {
      return { args }
    },
    template: '<PublishButton v-bind="args" />',
  }),
}

/** Publishing — spinner + "Publishing…" label, disabled while the save is in flight. */
export const Publishing: Story = {
  args: {
    loading: true,
  },
  render: (args: Args) => ({
    components: { PublishButton },
    setup() {
      return { args }
    },
    template: '<PublishButton v-bind="args" />',
  }),
}

/** Disabled — no content to publish or insufficient permissions. */
export const Disabled: Story = {
  args: {
    disabled: true,
  },
  render: (args: Args) => ({
    components: { PublishButton },
    setup() {
      return { args }
    },
    template: '<PublishButton v-bind="args" />',
  }),
}
