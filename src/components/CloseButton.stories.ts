import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import CloseButton from './CloseButton.vue'

type Story = StoryObj<typeof CloseButton>

const meta: Meta<typeof CloseButton> = {
  title: 'Atoms/CloseButton',
  component: CloseButton,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A small icon-only close button (×) used to dismiss panels, modals, or the diagram editor. Renders as a 32×32 rounded button with a subtle hover state. The `exit` prop is the callback invoked on click.',
      },
    },
  },
  argTypes: {
    exit: {
      action: 'exit',
      description: 'Callback invoked when the button is clicked',
    },
  },
}

export default meta

/** Default close button — idle state, light background. */
export const Default: Story = {
  render: (args: Args) => ({
    components: { CloseButton },
    setup() {
      return { args }
    },
    template: '<CloseButton v-bind="args" />',
  }),
}

/** On a dark/coloured toolbar background to verify the icon and hover remain legible. */
export const OnDarkBackground: Story = {
  render: (args: Args) => ({
    components: { CloseButton },
    setup() {
      return { args }
    },
    template: `
      <div style="background: #1d2125; padding: 8px; display: inline-flex; align-items: center; border-radius: 6px;">
        <CloseButton v-bind="args" />
      </div>
    `,
  }),
}

/** Inline with a label, as seen in header bars or dialog title rows. */
export const InlineWithLabel: Story = {
  render: (args: Args) => ({
    components: { CloseButton },
    setup() {
      return { args }
    },
    template: `
      <div style="display: flex; align-items: center; justify-content: space-between; width: 300px; padding: 4px 8px; border: 1px solid #e0e0e0; border-radius: 6px;">
        <span style="font-size: 14px; font-weight: 500; color: #172b4d;">Edit Diagram</span>
        <CloseButton v-bind="args" />
      </div>
    `,
  }),
}

/** Multiple close buttons side-by-side to confirm consistent sizing and spacing. */
export const Multiple: Story = {
  render: (args: Args) => ({
    components: { CloseButton },
    setup() {
      return { args }
    },
    template: `
      <div style="display: flex; gap: 8px; align-items: center;">
        <CloseButton v-bind="args" />
        <CloseButton v-bind="args" />
        <CloseButton v-bind="args" />
      </div>
    `,
  }),
}
