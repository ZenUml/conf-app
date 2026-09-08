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
const FAKE_DIAGRAM = `
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
        </div>`

/**
 * The fullscreen shape of the bug: GenericViewer gives `.screen-capture-content`
 * the layout column's width (`width:100%; max-width:1000px`), so a small diagram
 * is captured inside a box many times its size. Both a ZenUML sequence diagram
 * and a DrawIO graph land here.
 */
const WIDE_COLUMN_SEQUENCE = `
        <div style="height:0; overflow:hidden;">
          <div ref="diagramRef" style="width:1000px; padding:24px; background:#ffffff; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size:13px; color:#0f172a;">
            <div style="display:inline-block;">
              <div style="font-weight:700; margin-bottom:12px;">Login Flow</div>
              <div style="display:flex; gap:12px; margin-bottom:8px;"><span>Client</span><span>&rarr;</span><span>Auth</span></div>
              <div style="display:flex; gap:12px;"><span>Auth</span><span>&rarr;</span><span>200 OK</span></div>
            </div>
          </div>
        </div>`

const WIDE_COLUMN_GRAPH = `
        <div style="height:0; overflow:hidden;">
          <div ref="diagramRef" style="width:1000px; padding:24px; background:#ffffff;">
            <svg width="220" height="110" viewBox="0 0 220 110" xmlns="http://www.w3.org/2000/svg">
              <rect x="4" y="30" width="80" height="40" rx="4" fill="#ffffff" stroke="#111827"/>
              <text x="44" y="55" font-size="12" text-anchor="middle" font-family="sans-serif">Start</text>
              <line x1="84" y1="50" x2="132" y2="50" stroke="#111827"/>
              <rect x="132" y="30" width="84" height="40" rx="4" fill="#ffffff" stroke="#111827"/>
              <text x="174" y="55" font-size="12" text-anchor="middle" font-family="sans-serif">Try it here</text>
            </svg>
          </div>
        </div>`

function withCaptureStage(
  args: Args,
  configureState?: (state: ModalInstance['state']) => void,
  markup: string = FAKE_DIAGRAM,
) {
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
        ${markup}
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
 * Place one annotation the way the canvas does: `add` creates it at a point and
 * selects it, `update` gives it its far end and text. Stories must go through
 * this rather than writing `state.note` / `state.callout` — those legacy fields
 * belong to the retired sidebar surface (ExportPreview/ExportSidebar), which
 * ExportModal no longer renders, so setting them produces a story that shows
 * nothing at all. Found in Codex acceptance of the note-placed story.
 */
function place(
  state: ModalInstance['state'],
  type: 'note' | 'arrow' | 'callout' | 'rectangle',
  position: { x: number; y: number },
  end: { x: number; y: number },
  text = '',
) {
  const item = state.annotations.add(type, position)
  state.annotations.update(item.id, { end, text })
  return item
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
 * A text annotation sits on the diagram and is selected, so the contextual
 * properties bar appears above it.
 */
export const NotePlaced: Story = {
  name: 'Note placed (contextual properties)',
  render: (args: Args) => withCaptureStage(args, (state) => {
    place(state, 'note', { x: 0.5, y: 0.35 }, { x: 0.5, y: 0.35 }, 'Confirm before shipping')
  }),
}

/**
 * Every annotation type at once — two independent texts, an arrow, a rectangle
 * and a callout with its tail — which is the state a reviewer needs to judge
 * z-order, colour defaults and whether the properties bar follows the selection.
 */
export const AnnotationsMixed: Story = {
  name: 'All annotation types placed',
  render: (args: Args) => withCaptureStage(args, (state) => {
    place(state, 'note', { x: 0.22, y: 0.2 }, { x: 0.22, y: 0.2 }, 'Client starts here')
    place(state, 'note', { x: 0.68, y: 0.86 }, { x: 0.68, y: 0.86 }, 'Latency budget: 200ms')
    place(state, 'arrow', { x: 0.3, y: 0.34 }, { x: 0.62, y: 0.52 })
    place(state, 'rectangle', { x: 0.16, y: 0.6 }, { x: 0.52, y: 0.78 })
    const callout = place(state, 'callout', { x: 0.55, y: 0.24 }, { x: 0.66, y: 0.4 }, 'Retry happens here')
    state.annotations.select(callout.id)
  }),
}

/**
 * Two labels of equal length and wildly different width. The dashed selection
 * box and the click target must both track the rendered glyphs — a box derived
 * from the character count is far too wide for `i`s and too narrow for `W`s.
 */
export const TextMetrics: Story = {
  name: 'Text metrics (narrow vs wide glyphs)',
  render: (args: Args) => withCaptureStage(args, (state) => {
    place(state, 'note', { x: 0.3, y: 0.25 }, { x: 0.3, y: 0.25 }, 'iiiiiiiiii')
    const wide = place(state, 'note', { x: 0.5, y: 0.7 }, { x: 0.5, y: 0.7 }, 'WWWWWWWWWW')
    state.annotations.select(wide.id)
  }),
}

/**
 * A short sequence diagram captured inside the 1000px fullscreen column. The
 * preview must be the diagram's own size with even padding — not the column
 * with the diagram pushed to its left edge.
 */
export const WideColumnSequence: Story = {
  name: 'Fullscreen column, short sequence diagram',
  render: (args: Args) => withCaptureStage(args, undefined, WIDE_COLUMN_SEQUENCE),
}

/** The same column holding a small DrawIO-style graph. */
export const WideColumnGraph: Story = {
  name: 'Fullscreen column, small graph',
  render: (args: Args) => withCaptureStage(args, undefined, WIDE_COLUMN_GRAPH),
}

/**
 * A watermark longer than the default on a shallow diagram: rotated -45° it
 * used to overrun both edges and lose characters at each end.
 */
export const WatermarkLong: Story = {
  name: 'Long watermark on a shallow diagram',
  render: (args: Args) => withCaptureStage(args, (state) => {
    state.watermark.text = 'Internal review - Confidential'
    state.watermarkVisible.value = true
  }),
}

/**
 * A diagonal watermark on the canvas, nothing selected. Selection is the
 * workspace's own state, so click the watermark to check the rest: its outline
 * and hit target are drawn in the watermark's own rotated frame, so clicking
 * the visible glyphs — including the lower half — selects it.
 */
export const WatermarkPlaced: Story = {
  name: 'Watermark placed (rotated hit target)',
  render: (args: Args) => withCaptureStage(args, (state) => {
    state.watermarkVisible.value = true
  }),
}

/**
 * Close and reopen. The dialog is `v-if`'d on `visible`, so closing unmounts it
 * while ExportModal itself — and the export state it owns — stays alive; the
 * reopen must therefore bring the annotations back and re-run the capture.
 * Click the X (or the backdrop), then Reopen export, and check the annotations
 * are still on the canvas.
 */
export const CloseAndReopen: Story = {
  name: 'Close, then reopen (annotations survive)',
  render: (args: Args) => ({
    components: { ExportModal },
    setup() {
      const diagramRef = ref<HTMLElement | null>(null)
      const modalRef = ref<ModalInstance | null>(null)
      const getCaptureNode = () => diagramRef.value

      onMounted(() => {
        const state = modalRef.value!.state
        place(state, 'note', { x: 0.28, y: 0.3 }, { x: 0.28, y: 0.3 }, 'Survives a reopen')
        place(state, 'arrow', { x: 0.34, y: 0.44 }, { x: 0.66, y: 0.6 })
        modalRef.value!.capturePreview()
      })

      return { args, diagramRef, modalRef, getCaptureNode }
    },
    template: `
      <div>
        ${FAKE_DIAGRAM}
        <div style="padding:24px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          <button
            type="button"
            @click="args.visible = true"
            style="padding:8px 14px; border:1px solid #cbd5e1; border-radius:6px; background:#ffffff; font-size:13px; cursor:pointer;"
          >Reopen export</button>
          <p style="margin-top:12px; font-size:13px; color:#475569;">
            Close the dialog with its X, then reopen it: the two annotations must still be there.
          </p>
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
    // `add` selects what it creates, so the contextual properties bar opens on
    // the callout; `end` is the tail's tip.
    place(state, 'callout', { x: 0.46, y: 0.4 }, { x: 0.58, y: 0.55 }, 'Retry happens here')
  }),
}

/** A deliberately dense selected state for checking the properties bar's fit. */
export const FullscreenInnerOverflowEditing: Story = {
  name: 'Fullscreen (inner document, overflowing note controls)',
  render: (args: Args) => withCaptureStage(args, (state) => {
    place(
      state,
      'note',
      { x: 0.5, y: 0.35 },
      { x: 0.5, y: 0.35 },
      'A long note whose properties must remain reachable while the preview stays visible',
    )
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
