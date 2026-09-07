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
// Repro: PNG export resolution collapses for a downscaled vector diagram
// ---------------------------------------------------------------------------

/**
 * The PlantUML fixture from prod page 2774138946 in miniature: an SVG whose
 * intrinsic coordinate space is 4647x1469 rendered into a 562px-wide macro
 * column, i.e. downscaled 8.3x. `captureBlob` sizes the canvas from the
 * node's CSS box (`clientWidth` x devicePixelRatio), so the exported PNG is
 * 562x178 regardless of how much detail the source vector carries.
 *
 * The stage below reproduces exactly that geometry with generated text rows,
 * so the resolution loss is visible in the preview pane and measurable from
 * the play function.
 */
const OVERSIZED_VIEWBOX = { w: 4647, h: 1469 }
const STAGE_WIDTH = 562

function oversizedSvg(): string {
  const rows: string[] = []
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 5; c++) {
      const x = 40 + c * 920
      const y = 60 + r * 118
      rows.push(
        `<rect x="${x}" y="${y}" width="860" height="72" rx="12" fill="#f1f5f9" stroke="#94a3b8"/>` +
          `<text x="${x + 430}" y="${y + 44}" font-size="28" font-family="sans-serif" fill="#0f172a" text-anchor="middle">` +
          `branch ${c} step ${r} &#8212; validate, forward, and record outcome</text>`,
      )
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${OVERSIZED_VIEWBOX.w} ${OVERSIZED_VIEWBOX.h}" ` +
    `preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">` +
    `<rect width="${OVERSIZED_VIEWBOX.w}" height="${OVERSIZED_VIEWBOX.h}" fill="#ffffff"/>${rows.join('')}</svg>`
  )
}

function withOversizedStage(args: Args) {
  return {
    components: { ExportModal },
    setup() {
      const diagramRef = ref<HTMLElement | null>(null)
      const modalRef = ref<ModalInstance | null>(null)
      const getCaptureNode = () => diagramRef.value

      onMounted(() => {
        // Probe, not an assertion: log the canvas the export pipeline actually
        // encodes, so a manual Download PNG click prints the resolution next
        // to the source's intrinsic size. Idempotent across re-renders.
        const w = window as unknown as { __pngProbeInstalled?: boolean }
        if (!w.__pngProbeInstalled) {
          w.__pngProbeInstalled = true
          const original = HTMLCanvasElement.prototype.toBlob
          HTMLCanvasElement.prototype.toBlob = function patched(this: HTMLCanvasElement, ...rest) {
            // eslint-disable-next-line no-console
            console.log(
              `[PNGPROBE] source ${OVERSIZED_VIEWBOX.w}x${OVERSIZED_VIEWBOX.h}, ` +
                `stage ${STAGE_WIDTH}px, devicePixelRatio ${window.devicePixelRatio}, ` +
                `exported ${this.width}x${this.height}`,
            )
            return original.apply(this, rest as Parameters<typeof original>)
          } as typeof HTMLCanvasElement.prototype.toBlob
        }
        modalRef.value!.capturePreview()
      })

      return { args, diagramRef, modalRef, getCaptureNode, svg: oversizedSvg() }
    },
    template: `
      <div>
        <div style="height:0; overflow:hidden;">
          <div
            ref="diagramRef"
            class="screen-capture-content"
            :style="{ width: '${STAGE_WIDTH}px', background: '#ffffff' }"
            v-html="svg"
          ></div>
        </div>
        <ExportModal
          ref="modalRef"
          v-bind="args"
          :capture-node-getter="getCaptureNode"
          diagram-title="Order Placement"
          @close="args.visible = false"
        />
      </div>
    `,
  }
}

export const OversizedVectorLowRes: Story = {
  name: 'Repro: oversized vector exports at screen resolution',
  render: (args: Args) => withOversizedStage(args),
}
