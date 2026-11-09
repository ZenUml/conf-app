import { setup, type Args, type Meta, type StoryObj } from '@storybook/vue3-vite'
import type { App } from 'vue'
import mixpanel from 'mixpanel-browser'
import GenericViewer from './GenericViewer.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DataSource, DiagramType } from '@/model/Diagram/Diagram'
import { resetStubResponses } from '@/stubs/forge-bridge'

// Same reason as MacroWithAttribution.stories.ts: the real root app only gets
// the store through setup().
setup((app: App) => {
  app.use(store)
})

/**
 * Full variant, license explicitly inactive: diagonal watermark over the
 * diagram plus the upgrade strip below it. The real GenericViewer decides from
 * the build's PRODUCT_TYPE, the flag (standalone: localStorage
 * `mockNoLicenseNoticeEnabled === 'true'`) and `forgeContext.license.active`.
 * The `storybook` script pins PRODUCT_TYPE to `lite`, so run
 * `PRODUCT_TYPE=full pnpm exec storybook dev -p 6006` to see NoticeOn; under any
 * other build both stories correctly render no notice.
 */
const SAMPLE_MERMAID =
  'sequenceDiagram\n  participant Client\n  participant Server\n  Client->>Server: POST /login\n  Server-->>Client: 200 OK'

type Story = StoryObj<typeof GenericViewer>

function configureStory() {
  forgeGlobal.isForge = false
  forgeGlobal.isLite = false
  forgeGlobal.forgeContext = {
    accountId: 'storybook-user',
    environmentType: 'STAGING',
    license: { active: false },
    extension: { content: { id: 'storybook-page' }, space: { key: 'DOCS' } },
  }
  globals.apWrapper.canUserEdit = async () => true
  globals.apWrapper.getCurrentPage = async () => ({
    title: 'Login flow',
    body: { export_view: { value: '<p>Context.</p>' } },
    _links: { base: 'https://example-tenant.atlassian.net/wiki', webui: '/spaces/DOCS/pages/123456' },
  })
  const noop = () => {}
  ;(mixpanel as any).init = noop
  ;(mixpanel as any).register = noop
  ;(mixpanel as any).track = noop
  resetStubResponses()

  store.commit('updateDiagramType', DiagramType.Mermaid)
  store.commit('updateMermaidCode', SAMPLE_MERMAID)
  store.commit('updateCode2', '')
  store.commit('updatePlantUmlCode', '')
  store.commit('updateTitle', 'Login flow')
  const diagram = (store.state as any).diagram
  diagram.source = DataSource.CustomContent
  diagram.id = '93093905'
  diagram.isCopy = false
  diagram.recoveredFromOrphan = false
  diagram.snapshotFallback = false
  store.commit('setViewerLoadState', { viewerLoadState: 'ready' })
  store.commit('setDiagramAttribution', null)
}

// The viewer frame sizes itself to the diagram, so the diagram width decides
// which notice layout shows: under 520px the button drops below the text.
function viewerRenderer(diagramWidth: number) {
  return (args: Args) => renderViewer(args, diagramWidth)
}

function renderViewer(args: Args, diagramWidth = 420) {
  return {
    components: { GenericViewer },
    setup() {
      return { args }
    },
    template: `
      <div style="padding: 24px; background: #FAFBFC;">
        <GenericViewer v-bind="args">
          <svg viewBox="0 0 420 150" style="width: ${diagramWidth}px; max-width: 100%; display: block; margin: 0 auto;">
            <rect x="10" y="10" width="110" height="28" rx="4" fill="#DEEBFF" stroke="#4C9AFF"/>
            <text x="65" y="29" text-anchor="middle" font-size="12" fill="#172B4D">Client</text>
            <rect x="300" y="10" width="110" height="28" rx="4" fill="#DEEBFF" stroke="#4C9AFF"/>
            <text x="355" y="29" text-anchor="middle" font-size="12" fill="#172B4D">Server</text>
            <line x1="65" y1="38" x2="65" y2="140" stroke="#C1C7D0" stroke-dasharray="4 4"/>
            <line x1="355" y1="38" x2="355" y2="140" stroke="#C1C7D0" stroke-dasharray="4 4"/>
            <line x1="65" y1="70" x2="350" y2="70" stroke="#172B4D"/>
            <text x="210" y="64" text-anchor="middle" font-size="11" fill="#172B4D">POST /login</text>
            <line x1="355" y1="105" x2="70" y2="105" stroke="#172B4D" stroke-dasharray="4 3"/>
            <text x="210" y="99" text-anchor="middle" font-size="11" fill="#172B4D">200 OK</text>
          </svg>
        </GenericViewer>
      </div>
    `,
  }
}

const meta: Meta<typeof GenericViewer> = {
  title: 'Viewer/LicenseNotice',
  component: GenericViewer,
  parameters: { layout: 'fullscreen' },
}
export default meta

export const NoticeOff: Story = {
  decorators: [
    () => {
      configureStory()
      try { localStorage.removeItem('mockNoLicenseNoticeEnabled') } catch { /* storage blocked */ }
      return { template: '<story/>' }
    },
  ],
  render: renderViewer,
}

const noticeOnDecorator = () => {
  configureStory()
  try { localStorage.setItem('mockNoLicenseNoticeEnabled', 'true') } catch { /* storage blocked */ }
  return { template: '<story/>' }
}

export const NoticeOn: Story = {
  decorators: [noticeOnDecorator],
  render: viewerRenderer(720),
}

export const NoticeOnNarrowDiagram: Story = {
  decorators: [noticeOnDecorator],
  render: viewerRenderer(420),
}
