import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AdvocacyButton from './AdvocacyButton.vue'

const meta: Meta<typeof AdvocacyButton> = {
  title: 'Shared/AdvocacyButton',
  component: AdvocacyButton,
  tags: ['ai-generated'],
  parameters: {
    docs: {
      description: {
        component:
          'Copies a pre-written upgrade request to the clipboard. After a successful copy the button ' +
          'turns green and reads "Copied" for 2.5 s, then the label fades out over 0.3 s before it ' +
          'returns to "Copy upgrade request".',
      },
    },
  },
  args: {
    message: 'Hi, could we upgrade ZenUML Diagrams for Confluence to the Full plan? Lite limits are blocking our team.',
  },
  decorators: [
    () => ({
      template: '<div class="w-[360px] pt-4"><story /></div>',
    }),
  ],
}

export default meta

type Story = StoryObj<typeof AdvocacyButton>

/** Default state: the copy button, ready to be clicked. */
export const Idle: Story = {}
