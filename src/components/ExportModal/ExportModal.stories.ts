import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import { onMounted, ref } from 'vue'
import ExportModal from './ExportModal.vue'

type Story = StoryObj<typeof ExportModal>
type ModalInstance = InstanceType<typeof ExportModal>

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

// ExportModal creates and provide()s its own export state inside its own
// setup() (see ExportModal.vue), which shadows anything a parent provide()s
// under the same injection key — a decorator-level provide never reaches
// the sidebar/preview. To drive a specific state in these stories we mount
// a small fake diagram (collapsed via a zero-height, overflow:hidden
// wrapper — NOT position:fixed/absolute, which html-to-image fails to
// capture; verified empirically), wire it in through the real
// `captureNodeGetter` prop (the same mechanism GenericViewer uses for the
// live app), and reach the modal's own reactive `state` via a template ref
// — the same access pattern ExportModal.spec.ts already uses via
// `wrapper.vm.state`. This runs the real html-to-image capture pipeline
// instead of faking a preview data URL that the component would never see.
function withCaptureStage(args: Args, configureState?: (state: ModalInstance['state']) => void) {
  return {
    components: { ExportModal },
    setup() {
      const diagramRef = ref<HTMLElement | null>(null)
      const modalRef = ref<ModalInstance | null>(null)
      const getCaptureNode = () => diagramRef.value

      onMounted(() => {
        configureState?.(modalRef.value!.state)
        modalRef.value!.capturePreview()
      })

      return { args, diagramRef, modalRef, getCaptureNode }
    },
    template: `
      <div>
        <div style="height:0; overflow:hidden;">
          <div
            ref="diagramRef"
            style="width:420px; padding:28px; background:#ffffff; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size:13px; color:#0f172a;"
          >
            <div style="font-weight:700; margin-bottom:14px;">Login Flow</div>
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
              <span>Client</span><span>&rarr;</span><span>Auth Service</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span>Auth Service</span><span>&rarr;</span><span>Client: 200 OK</span>
            </div>
          </div>
        </div>
        <ExportModal
          ref="modalRef"
          v-bind="args"
          :capture-node-getter="getCaptureNode"
          diagram-title="Login Flow"
          @close="args.visible = false"
        />
      </div>
    `,
  }
}

/**
 * Initial state — modal open, white background selected (the default),
 * preview captured from a real diagram via the actual html-to-image
 * pipeline, no annotations, export button idle. This matches what a user
 * sees the moment they first open the modal.
 */
export const Initial: Story = {
  name: 'Initial (white background)',
  render: (args: Args) => withCaptureStage(args),
}

/**
 * Cool (blue-tinted) background selected, mirroring the moment a user has
 * picked a background before hitting Download PNG.
 */
export const CoolBackground: Story = {
  name: 'Cool background',
  render: (args: Args) => withCaptureStage(args, (state) => {
    state.background.value = 'cool'
  }),
}

/**
 * A note has been dragged onto the diagram and is selected, so the sidebar
 * shows the Note Properties panel.
 */
export const NotePlaced: Story = {
  name: 'Note placed (Note Properties panel)',
  render: (args: Args) => withCaptureStage(args, (state) => {
    state.note.text = 'Confirm before shipping'
    state.notePoint.value = { x: 0.5, y: 0.35 }
    state.selectedAnnotation.value = 'note'
  }),
}

/**
 * Exporting in progress — the Download PNG button shows a spinner and
 * "Exporting…" label while the file is being generated and saved.
 */
export const Exporting: Story = {
  name: 'Exporting (in progress)',
  render: (args: Args) => withCaptureStage(args, (state) => {
    state.isExporting.value = true
  }),
}

/**
 * Export failed — capture/encode returned a failure or threw, so the
 * sidebar surfaces the inline error message instead of closing silently.
 */
export const ExportFailed: Story = {
  name: 'Export failed',
  render: (args: Args) => withCaptureStage(args, (state) => {
    state.exportError.value = "Export failed — couldn't capture the diagram. Try Refresh, then export again."
  }),
}
