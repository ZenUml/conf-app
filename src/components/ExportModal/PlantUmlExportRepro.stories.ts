// Root tsc uses legacy Node resolution; Storybook 10 exposes these through
// package exports. The Storybook/Vite build resolves them.
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import mixpanel from 'mixpanel-browser'
import { FeatureFlags } from '@forge/bridge'
import DiagramPortal from '@/components/DiagramPortal.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DataSource, DiagramType } from '@/model/Diagram/Diagram'
import { resetFeatureFlagsForTests } from '@/apis/aiTitleFeatureFlag'
import { resetStubResponses } from '@/stubs/forge-bridge'

/**
 * High-fidelity reproduction of the PNG-export resolution loss reported on
 * production page 2774138946 (second macro, customContentId 3055976615).
 *
 * Unlike the geometry-only repro in ExportModal.stories.ts, this mounts the
 * component tree production mounts — DiagramPortal -> GenericViewer ->
 * PlantUml — so the SVG comes from www.plantuml.com over the network
 * (PlantUml.vue's `fetchSvg`), Export PNG is the real toolbar button, and the
 * capture node is the real `.screen-capture-content`.
 *
 * Two facts of the production environment are what make the defect visible,
 * and both are reproduced by loading the viewer inside a 564x256 iframe:
 *  - the macro column is ~562px wide, so a 4647x1469 diagram is fit to width
 *    and `captureBlob` (which sizes its canvas from the node's CSS box)
 *    encodes at that width;
 *  - ExportModal's backdrop is `position: fixed` and its panels are sized in
 *    viewport units, so the dialog is boxed into the macro iframe rather than
 *    the roomy two-column layout a full-size Storybook canvas would give it.
 *
 * Open the frame story, click Export PNG, then Download PNG, and read the
 * console: `[PNGPROBE] ... exported <w>x<h>` beside the source's viewBox.
 */

type Story = StoryObj<typeof DiagramPortal>

setup((app: { use(plugin: typeof store): unknown }) => {
  app.use(store)
})

/** The macro iframe's viewport on the production page, measured live. */
const MACRO_FRAME_WIDTH_PX = 564
const MACRO_FRAME_HEIGHT_PX = 256

const MACRO_FRAME_STYLE = {
  width: `${MACRO_FRAME_WIDTH_PX}px`,
  height: `${MACRO_FRAME_HEIGHT_PX}px`,
  border: '1px solid #cbd5e1',
  display: 'block',
  background: '#ffffff',
}

/** Story id of the inner story the frame loads — tracks its export name. */
const INNER_STORY_ID = 'modal-plantumlexportrepro--macro-frame-inner'

/**
 * The production fixture's shape, regenerated rather than pasted: a
 * 12-branch switch, 22 activity steps per branch, the same title and step
 * wording. Verified against the live custom content body (283 lines, 12
 * `case` blocks, 264 step lines) — the source that renders to a 4647x1469
 * viewBox.
 */
const BRANCH_COUNT = 12
const STEPS_PER_BRANCH = 22

function buildPlantUmlFixture(): string {
  const lines = [
    '@startuml',
    'title ShopeePay-scale fixture — wide and tall',
    'start',
    'switch (amount trigger?)',
  ]
  for (let branch = 0; branch < BRANCH_COUNT; branch++) {
    lines.push(`case ( code ${8000 + branch} )`)
    for (let step = 0; step < STEPS_PER_BRANCH; step++) {
      lines.push(`  :branch ${branch} step ${step} — validate, forward, and record outcome;`)
    }
  }
  lines.push('endswitch', ':merge results;', 'stop', '@enduml')
  return lines.join('\n')
}

const PLANTUML_FIXTURE = buildPlantUmlFixture()

const SAMPLE_PAGE = {
  id: 'storybook-page',
  title: 'E2E test page',
  body: { export_view: { value: '<p>Storybook</p>' } },
}

function configureStory() {
  resetStubResponses()
  resetFeatureFlagsForTests()
  FeatureFlags.prototype.checkFlag = function (_key: string, defaultValue = false) {
    return defaultValue
  }

  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.invalid'
  forgeGlobal.forgeContext = {
    accountId: 'storybook-user',
    extension: { content: { id: 'storybook-page' }, space: { key: 'DOCS' }, config: {} },
  }

  globals.apWrapper.canUserEdit = async () => true
  globals.apWrapper.initializeContext = async () => undefined
  globals.apWrapper.getCurrentPage = async () => SAMPLE_PAGE

  const noop = () => {}
  ;(mixpanel as any).init = noop
  ;(mixpanel as any).register = noop
  ;(mixpanel as any).track = noop

  store.commit('updateDiagramType', DiagramType.PlantUml)
  store.commit('updateCode2', '')
  store.commit('updateMermaidCode', '')
  store.commit('updatePlantUmlCode', PLANTUML_FIXTURE)
  store.commit('updateTitle', 'Order Placement')
  const diagram = (store.state as any).diagram
  diagram.source = DataSource.CustomContent
  diagram.id = 'cc-3055976615'
  diagram.isCopy = false
  diagram.recoveredFromOrphan = false
  diagram.snapshotFallback = false
  diagram.snapshotAt = undefined
  store.commit('setDiagramAttribution', null)
}

/**
 * Logs the canvas the export pipeline actually encodes, alongside the source
 * SVG's intrinsic viewBox read off the live DOM. A probe, not an assertion —
 * the story is for looking at, and the export is triggered by hand.
 */
function installPngProbe() {
  const w = window as unknown as { __pngProbeInstalled?: boolean }
  if (w.__pngProbeInstalled) return
  w.__pngProbeInstalled = true
  const original = HTMLCanvasElement.prototype.toBlob
  HTMLCanvasElement.prototype.toBlob = function patched(this: HTMLCanvasElement, ...rest) {
    const node = document.querySelector('.screen-capture-content')
    const svg = node?.querySelector('svg')
    // eslint-disable-next-line no-console
    console.log(
      `[PNGPROBE] source viewBox ${svg?.getAttribute('viewBox') ?? 'unknown'}, ` +
        `rendered ${node ? `${node.clientWidth}x${node.clientHeight}` : 'unknown'}, ` +
        `devicePixelRatio ${window.devicePixelRatio}, exported ${this.width}x${this.height}`,
    )
    return original.apply(this, rest as Parameters<typeof original>)
  } as typeof HTMLCanvasElement.prototype.toBlob
}

const meta: Meta<typeof DiagramPortal> = {
  title: 'Modal/PlantUmlExportRepro',
  component: DiagramPortal,
  tags: ['ai-generated'],
  parameters: { layout: 'fullscreen' },
}

export default meta

/**
 * The macro's own document. Loaded by the frame story below; open it on its
 * own only to debug the render — at full canvas width the export dialog gets
 * a two-column layout no user of this macro ever sees.
 */
export const MacroFrameInner: Story = {
  name: 'Repro (inner document, load via the frame story)',
  decorators: [
    () => {
      configureStory()
      installPngProbe()
      return { template: '<story />' }
    },
  ],
  render: () => ({
    components: { DiagramPortal },
    template: `<DiagramPortal :autoResize="true" />`,
  }),
}

/** Production shape: the viewer inside a real macro-sized iframe. */
export const PlantUmlExportProductionShape: Story = {
  name: 'Repro (production shape): PlantUML macro in a 564x256 frame',
  render: () => ({
    setup() {
      return {
        frameStyle: MACRO_FRAME_STYLE,
        src: `iframe.html?id=${INNER_STORY_ID}&viewMode=story`,
      }
    },
    template: `
      <div style="padding:24px; background:#f8fafc; min-height:100vh;">
        <iframe :src="src" :style="frameStyle" title="Macro frame (564x256)"></iframe>
      </div>
    `,
  }),
}
