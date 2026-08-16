import { setup, type Args, type Meta, type StoryObj } from '@storybook/vue3-vite'
import type { App } from 'vue'
import mixpanel from 'mixpanel-browser'
import GenericViewer from './GenericViewer.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DataSource, DiagramType } from '@/model/Diagram/Diagram'
import { resetStubResponses, stubResponses } from '@/stubs/forge-bridge'

// Same reason as GenericViewer.stories.ts: on @storybook/vue3-vite 10.4 the
// `app: (app) => app.use(store)` decorator idiom does NOT install the plugin on
// the real root app. setup() is the framework's actual extension point.
setup((app: App) => {
  app.use(store)
})

/**
 * The macro viewer WITH its attribution footer — the pair as a reader sees it,
 * rather than the footer in isolation (`Viewer/DiagramAttributionFooter`).
 *
 * The footer is not a prop of GenericViewer. It renders from Vuex state:
 * `v-if="!isLoadFailed && diagramAttribution"` (GenericViewer.vue:263), fed by
 * `state.diagramAttribution`. So each story commits `setDiagramAttribution` and
 * lets the real component decide — which is what makes `WithoutAttribution`
 * below an honest reproduction rather than a mock-up.
 *
 * Name and audience lookups reach `@forge/bridge`, which Storybook aliases to
 * `src/stubs/forge-bridge.ts` (see `.storybook/main.ts`); the stub's
 * `stubResponses` supplies per-story data. Note these lookups only work inside
 * the full Storybook UI, not `iframe.html` opened directly: `forgeRequest`
 * branches on `window.self === window.top` (requestUtil.ts:41) and takes its
 * MockAp path when the story is the top frame, leaving the names blank.
 */
const CREATOR = 'acct-creator'
const UPDATER = 'acct-updater'

const SAMPLE_MERMAID =
  'sequenceDiagram\n  participant Client\n  participant Server\n  Client->>Server: POST /login\n  Server-->>Client: 200 OK'

type Story = StoryObj<typeof GenericViewer>

function configureStory(options: {
  attribution?: { customContentId: string; createdByAccountId?: string; lastUpdatedByAccountId?: string } | null
  users?: Record<string, { displayName: string }>
  audienceCount?: number
}) {
  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  forgeGlobal.forgeContext = {
    accountId: 'storybook-user',
    extension: { content: { id: 'storybook-page' }, space: { key: 'DOCS' } },
  }
  globals.apWrapper.canUserEdit = async () => true
  globals.apWrapper.getCurrentPage = async () => ({
    title: 'Login flow — architecture notes',
    body: { export_view: { value: '<p>Context.</p>' } },
    _links: { base: 'https://example-tenant.atlassian.net/wiki', webui: '/spaces/DOCS/pages/123456' },
  })
  // VITE_MIXPANEL_TOKEN is '' in Storybook and mixpanel-browser throws on an
  // empty token; trackAnalyticsEvent swallows it, so this only keeps the
  // console clean. Same treatment as GenericViewer.stories.ts.
  const noop = () => {}
  ;(mixpanel as any).init = noop
  ;(mixpanel as any).register = noop
  ;(mixpanel as any).track = noop

  resetStubResponses()
  stubResponses.users = options.users ?? {}
  if (options.audienceCount !== undefined) {
    stubResponses.remote = [
      { match: '/api/diagram-impact', body: { audienceCount: options.audienceCount, viewerRelation: 'viewer' } },
    ]
  }

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
  // The footer's `ready` prop is `viewerLoadState === 'ready'`; it gates only
  // the 3-second view-registration timer, not the render.
  store.commit('setViewerLoadState', { viewerLoadState: 'ready' })
  store.commit('setDiagramAttribution', options.attribution ?? null)
}

/**
 * Stand-in for the rendered diagram. These stories are about the footer's
 * relationship to the macro frame, so the diagram slot carries a placeholder
 * instead of booting a real renderer — the same approach GenericViewer's own
 * stories take.
 */
function renderViewer(args: Args) {
  return {
    components: { GenericViewer },
    setup() {
      return { args }
    },
    template: `
      <div style="padding: 24px; background: #FAFBFC;">
        <GenericViewer v-bind="args">
          <svg viewBox="0 0 420 150" style="width: 100%; max-width: 420px; display: block; margin: 0 auto;">
            <rect x="10"  y="10" width="110" height="28" rx="4" fill="#DEEBFF" stroke="#4C9AFF"/>
            <text x="65"  y="29" text-anchor="middle" font-size="12" fill="#172B4D">Client</text>
            <rect x="300" y="10" width="110" height="28" rx="4" fill="#DEEBFF" stroke="#4C9AFF"/>
            <text x="355" y="29" text-anchor="middle" font-size="12" fill="#172B4D">Server</text>
            <line x1="65"  y1="38" x2="65"  y2="140" stroke="#C1C7D0" stroke-dasharray="4 4"/>
            <line x1="355" y1="38" x2="355" y2="140" stroke="#C1C7D0" stroke-dasharray="4 4"/>
            <line x1="65"  y1="70" x2="350" y2="70" stroke="#172B4D"/>
            <polygon points="355,70 347,66 347,74" fill="#172B4D"/>
            <text x="210" y="64" text-anchor="middle" font-size="11" fill="#172B4D">POST /login</text>
            <line x1="355" y1="105" x2="70" y2="105" stroke="#172B4D" stroke-dasharray="4 3"/>
            <polygon points="65,105 73,101 73,109" fill="#172B4D"/>
            <text x="210" y="99" text-anchor="middle" font-size="11" fill="#172B4D">200 OK</text>
          </svg>
        </GenericViewer>
      </div>
    `,
  }
}

const meta: Meta<typeof GenericViewer> = {
  title: 'Viewer/Macro with attribution',
  component: GenericViewer,
  parameters: { layout: 'fullscreen' },
}
export default meta

/** The macro as a reader sees it after a normal load: diagram, then the footer. */
export const MacroWithFooter: Story = {
  decorators: [
    () => {
      configureStory({
        attribution: {
          customContentId: '93093905',
          createdByAccountId: CREATOR,
          lastUpdatedByAccountId: UPDATER,
        },
        users: {
          [CREATOR]: { displayName: 'Robot Yanhui' },
          [UPDATER]: { displayName: 'Peng Xiao' },
        },
        audienceCount: 7,
      })
      return { template: '<story/>' }
    },
  ],
  render: renderViewer,
}

/** One author, and the diagram-impact backend has no count for it yet. */
export const MacroWithFooterMinimal: Story = {
  decorators: [
    () => {
      configureStory({
        attribution: { customContentId: '93093905', createdByAccountId: CREATOR },
        users: { [CREATOR]: { displayName: 'Robot Yanhui' } },
      })
      return { template: '<story/>' }
    },
  ],
  render: renderViewer,
}

/**
 * The defect this branch fixes, reproduced through the real component.
 *
 * On a repeat visit the content-SWR cache-hit path in `forgeIndex.ts` mounted
 * the viewer without attribution, so `state.diagramAttribution` stayed null and
 * `v-if` dropped the footer — the diagram rendered, the byline did not. Compare
 * against `MacroWithFooter`: same diagram, same viewer, only the state differs.
 */
export const MacroWithoutFooter: Story = {
  decorators: [
    () => {
      configureStory({ attribution: null })
      return { template: '<story/>' }
    },
  ],
  render: renderViewer,
}
