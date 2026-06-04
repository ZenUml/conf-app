import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import { provide } from 'vue'
import ExportModal from './ExportModal.vue'
import { exportStateKey, useExportState } from './useExportState'

// A 1×1 transparent PNG data URL — stand-in for a real diagram capture
const STUB_PREVIEW =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

type Story = StoryObj<typeof ExportModal>

const meta: Meta<typeof ExportModal> = {
  title: 'Features/ExportModal',
  component: ExportModal,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Full-screen export modal with a live preview pane (left) and a settings sidebar (right). ' +
          'The modal captures the diagram via html-to-image when opened, lets the user adjust background ' +
          'and annotations, then downloads a PNG. Use the `visible` prop to show/hide it.',
      },
    },
  },
  argTypes: {
    visible: {
      control: 'boolean',
      description: 'When true the export modal is displayed.',
    },
  },
  args: {
    visible: true,
  },
  decorators: [
    () => ({
      template: '<div class="min-h-screen bg-slate-800"><story /></div>',
    }),
  ],
}

export default meta

/**
 * Initial state — modal open, white background selected (the default),
 * preview captured, no annotations, export button idle.
 * This matches the state a user sees the moment they first open the modal.
 */
export const SvgSelected: Story = {
  name: 'Initial (white background)',
  render: (args: Args) => ({
    components: { ExportModal },
    setup() {
      const state = useExportState()
      state.background.value = 'white'
      state.previewDataUrl.value = STUB_PREVIEW
      state.isCapturing.value = false
      state.isExporting.value = false
      provide(exportStateKey, state)
      return { args }
    },
    template: `<ExportModal v-bind="args" @close="args.visible = false" />`,
  }),
}

/**
 * PNG export — cool (blue-tinted) background selected, mirroring the moment
 * a user has picked a background before hitting Download PNG.
 */
export const PngSelected: Story = {
  name: 'PNG ready (cool background)',
  render: (args: Args) => ({
    components: { ExportModal },
    setup() {
      const state = useExportState()
      state.background.value = 'cool'
      state.previewDataUrl.value = STUB_PREVIEW
      state.isCapturing.value = false
      state.isExporting.value = false
      provide(exportStateKey, state)
      return { args }
    },
    template: `<ExportModal v-bind="args" @close="args.visible = false" />`,
  }),
}

/**
 * Exporting in progress — the Download PNG button shows a spinner and
 * "Exporting…" label while the file is being generated and saved.
 */
export const Exporting: Story = {
  name: 'Exporting (in progress)',
  render: (args: Args) => ({
    components: { ExportModal },
    setup() {
      const state = useExportState()
      state.background.value = 'white'
      state.previewDataUrl.value = STUB_PREVIEW
      state.isCapturing.value = false
      state.isExporting.value = true
      provide(exportStateKey, state)
      return { args }
    },
    template: `<ExportModal v-bind="args" @close="() => {}" />`,
  }),
}
