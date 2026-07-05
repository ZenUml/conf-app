import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import PublishButton from './PublishButton.vue'

type Story = StoryObj<typeof PublishButton>

const meta: Meta<typeof PublishButton> = {
  title: 'Actions/PublishButton',
  component: PublishButton,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The primary publish action button used in the diagram editor header. ' +
          'Triggers `saveAndExit` on click and can be disabled while a save is in progress or when there is nothing to publish.',
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

/** Saved — button re-enabled after a successful save (ready for the next publish). */
export const Saved: Story = {
  args: {
    disabled: false,
  },
  render: (args: Args) => ({
    components: { PublishButton },
    setup() {
      return { args }
    },
    template: `
      <div style="display: flex; align-items: center; gap: 12px;">
        <PublishButton v-bind="args" />
        <span style="font-size: 12px; color: #16a34a;">Saved ✓</span>
      </div>
    `,
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
