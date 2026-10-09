import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import { onMounted, ref } from 'vue'
import ExportModal from './ExportModal.vue'

type Story = StoryObj<typeof ExportModal>
type ModalInstance = InstanceType<typeof ExportModal>

const meta: Meta<typeof ExportModal> = {
  title: 'Modal/ExportModal',
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

// ---------------------------------------------------------------------------
// Fullscreen-modal review stories
// ---------------------------------------------------------------------------

/**
 * The export dialog now opens inside the Forge Fullscreen modal (Export PNG on
 * the inline macro routes there, because the macro iframe — 564x256 on
 * production page 2774138946 — cannot host it). These stories render the dialog
 * at the sizes that modal actually has, so its layout can be reviewed at the
 * proportions a user meets rather than at whatever the Storybook canvas is.
 *
 * `MODAL_SIZES` are measured: 1280x563 is a laptop with the Atlassian modal
 * header taken off; 1920x950 is an external display. The inner story is loaded
 * in a real iframe of that size, because the dialog is `position: fixed` and
 * sized in viewport units — both resolve against the iframe's viewport, not the
 * page's.
 */
const MODAL_SIZES = {
  narrow: { width: 880, height: 720 },
  laptop: { width: 1280, height: 563 },
  desktop: { width: 1920, height: 950 },
} as const

const INNER_IDS = {
  plain: 'modal-exportmodal--fullscreen-inner',
  editing: 'modal-exportmodal--fullscreen-inner-editing',
  overflow: 'modal-exportmodal--fullscreen-inner-overflow-editing',
} as const

function inFrame(size: { width: number; height: number }, innerId: string) {
  return {
    setup() {
      return {
        style: {
          width: `${size.width}px`,
          height: `${size.height}px`,
          border: '1px solid #cbd5e1',
          display: 'block',
          background: '#ffffff',
        },
        src: `iframe.html?id=${innerId}&viewMode=story`,
        label: `Fullscreen modal ${size.width}x${size.height}`,
      }
    },
    template: `
      <div style="padding:16px; background:#f8fafc;">
        <iframe :src="src" :style="style" :title="label"></iframe>
      </div>
    `,
  }
}

/** The dialog alone, for the frame stories below to load. */
export const FullscreenInner: Story = {
  name: 'Fullscreen (inner document — load via a frame story)',
  render: (args: Args) => withCaptureStage(args),
}

/** Mid-annotation: a callout is placed and selected, so its properties show. */
export const FullscreenInnerEditing: Story = {
  name: 'Fullscreen (inner document, callout selected)',
  render: (args: Args) => withCaptureStage(args, (state) => {
    // hasCallout is computed from position + text, so setting those two is
    // what makes the callout real; selecting it opens its properties panel.
    state.callout.text = 'Retry happens here'
    state.callout.position = { x: 0.46, y: 0.4 }
    state.callout.tipPosition = { x: 0.58, y: 0.55 }
    state.selectedAnnotation.value = 'callout'
  }),
}

/** A deliberately dense selected state for checking sidebar scrolling. */
export const FullscreenInnerOverflowEditing: Story = {
  name: 'Fullscreen (inner document, overflowing note controls)',
  render: (args: Args) => withCaptureStage(args, (state) => {
    state.note.text = 'A long note whose properties must remain reachable while the preview stays visible'
    state.notePoint.value = { x: 0.5, y: 0.35 }
    state.selectedAnnotation.value = 'note'
  }),
}

export const FullscreenNarrow: Story = {
  name: 'Fullscreen at 880x720 (stacking breakpoint)',
  render: () => inFrame(MODAL_SIZES.narrow, INNER_IDS.editing),
}

export const FullscreenOverflowEditing: Story = {
  name: 'Fullscreen at 1280x420 (overflowing sidebar)',
  render: () => inFrame({ width: 1280, height: 420 }, INNER_IDS.overflow),
}

export const FullscreenLaptop: Story = {
  name: 'Fullscreen at 1280x563 (laptop)',
  render: () => inFrame(MODAL_SIZES.laptop, INNER_IDS.plain),
}

export const FullscreenLaptopEditing: Story = {
  name: 'Fullscreen at 1280x563, editing a callout',
  render: () => inFrame(MODAL_SIZES.laptop, INNER_IDS.editing),
}

export const FullscreenDesktop: Story = {
  name: 'Fullscreen at 1920x950 (external display)',
  render: () => inFrame(MODAL_SIZES.desktop, INNER_IDS.plain),
}

export const FullscreenDesktopEditing: Story = {
  name: 'Fullscreen at 1920x950, editing a callout',
  render: () => inFrame(MODAL_SIZES.desktop, INNER_IDS.editing),
}
