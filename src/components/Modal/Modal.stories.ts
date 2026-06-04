import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import Modal from './Modal.vue'

type Story = StoryObj<typeof Modal>

const meta: Meta<typeof Modal> = {
  title: 'Layout/Modal',
  component: Modal,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A centred overlay modal with named slots for header and body content and built-in Cancel / Confirm action buttons. Visibility is controlled via the `visible` prop; confirmation and cancellation are handled by the `onConfirm` and `onCancel` prop callbacks.',
      },
    },
  },
  argTypes: {
    visible: {
      control: 'boolean',
      description: 'When true the modal overlay is displayed; when false it is hidden.',
    },
  },
  args: {
    visible: true,
    onConfirm: () => undefined,
    onCancel: () => undefined,
  },
  decorators: [
    () => ({
      template: '<div class="min-h-screen bg-slate-200 relative"><story /></div>',
    }),
  ],
}

export default meta

/** Modal in its open state with a header and descriptive body content. */
export const Open: Story = {
  args: {
    visible: true,
  },
  render: (args: Args) => ({
    components: { Modal },
    setup() {
      return { args }
    },
    template: `
      <Modal v-bind="args">
        <template #header>
          <h2 class="text-lg font-semibold mb-2">Confirm action</h2>
        </template>
        <template #body>
          <p class="text-sm text-slate-700">Are you sure you want to proceed? This action cannot be undone.</p>
        </template>
      </Modal>
    `,
  }),
}

/** Modal with the overlay hidden — the backdrop and dialog are not rendered. */
export const Closed: Story = {
  args: {
    visible: false,
  },
  render: (args: Args) => ({
    components: { Modal },
    setup() {
      return { args }
    },
    template: `
      <div>
        <p class="p-8 text-slate-500 text-sm">The modal is hidden (visible=false). No overlay or dialog should appear.</p>
        <Modal v-bind="args">
          <template #header>
            <h2 class="text-lg font-semibold mb-2">Confirm action</h2>
          </template>
          <template #body>
            <p class="text-sm text-slate-700">This content is not visible when the modal is closed.</p>
          </template>
        </Modal>
      </div>
    `,
  }),
}

/** Modal with only a body slot — the header slot is left empty. */
export const NoHeader: Story = {
  args: {
    visible: true,
  },
  render: (args: Args) => ({
    components: { Modal },
    setup() {
      return { args }
    },
    template: `
      <Modal v-bind="args">
        <template #body>
          <p class="text-sm text-slate-700">This modal has no header — only body content and the action buttons.</p>
        </template>
      </Modal>
    `,
  }),
}

/** Interactive toggle — click the trigger button to open the modal, then use Cancel or Confirm to close it. */
export const Interactive: Story = {
  render: () => ({
    components: { Modal },
    setup() {
      const visible = ref(false)
      const open = () => { visible.value = true }
      const onConfirm = () => { visible.value = false }
      const onCancel = () => { visible.value = false }
      return { visible, open, onConfirm, onCancel }
    },
    template: `
      <div class="p-8">
        <button
          class="px-4 py-2 bg-blue-600 text-white rounded text-sm"
          @click="open"
        >Open modal</button>
        <Modal :visible="visible" :on-confirm="onConfirm" :on-cancel="onCancel">
          <template #header>
            <h2 class="text-lg font-semibold mb-2">Delete diagram?</h2>
          </template>
          <template #body>
            <p class="text-sm text-slate-700">
              This will permanently delete the diagram and all its history.
              Click <strong>Confirm</strong> to proceed or <strong>Cancel</strong> to go back.
            </p>
          </template>
        </Modal>
      </div>
    `,
  }),
}
