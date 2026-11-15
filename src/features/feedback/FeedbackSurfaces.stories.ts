import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import { reactive } from 'vue'
import { publishCommentsContext, resetCommentsContext } from '@/features/diagramComments/commentsContextStore'
import GenericViewer from '@/components/Viewer/GenericViewer.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DiagramType } from '@/model/Diagram/Diagram'
import FeedbackHost from './FeedbackHost.vue'
import { storyFeedbackContext } from './feedbackStoryFixtures'

setup((app) => app.use(store))

function configureFullscreen() {
  store.commit('updateDiagramType', DiagramType.Mermaid)
  store.commit('updateMermaidCode', 'flowchart LR\n  Client --> Service --> Database')
  store.commit('updateTitle', 'Architecture overview')
  forgeGlobal.isForge = false
  forgeGlobal.forgeContext = {
    moduleKey: 'zenuml-mermaid-macro-lite',
    extension: { modal: { macroMode: 'fullscreen' }, content: { id: 'content-example' }, space: { key: 'DOCS' } },
  }
  globals.apWrapper.canUserEdit = async () => true
  globals.apWrapper.getCurrentPage = async () => ({ title: 'Example page' }) as any
}

type Story = StoryObj<typeof FeedbackHost>
const meta: Meta<typeof FeedbackHost> = {
  title: 'Viewer/FeedbackSurfaces',
  component: FeedbackHost,
  parameters: { layout: 'fullscreen' },
  args: { context: storyFeedbackContext('fullscreen') },
  render: (args) => {
    configureFullscreen()
    return {
      components: { GenericViewer, FeedbackHost },
      setup: () => ({ args }),
      template: `<GenericViewer>
        <div style="height:calc(100vh - 100px);display:grid;place-items:center;">
          <div style="display:flex;align-items:center;gap:48px;font:14px system-ui;color:#172b4d;">
            <div style="padding:24px 32px;border:1px solid #b6c2cf;border-radius:8px;background:white;">Client</div>
            <span>→</span>
            <div style="padding:24px 32px;border:1px solid #b6c2cf;border-radius:8px;background:white;">Service</div>
          </div>
        </div>
      </GenericViewer><FeedbackHost v-bind="args" />`,
    }
  },
}
export default meta

async function revealAndOpen(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const trigger = canvas.getByRole('button', { name: 'Send feedback' })
  await userEvent.hover(canvas.getByTestId('feedback-edge'))
  await userEvent.click(trigger)
}

export const Collapsed: Story = {}

export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByTestId('feedback-edge'))
  },
}

export const Open: Story = { play: async ({ canvasElement }) => revealAndOpen(canvasElement) }

/**
 * The viewer surface with Comments on: the Comments button sits above the feedback
 * button, which is renamed "Report a bug". Flag off (or an anonymous viewer) shows
 * only the original Feedback button, as in Collapsed.
 */
export const WithCommentsButton: Story = {
  args: {
    context: storyFeedbackContext('viewer'),
    comments: reactive({
      enabled: true,
      pageId: '42',
      pageUrl: 'https://example.atlassian.net/wiki/spaces/OP/pages/42/Checkout',
      localId: 'loc-1',
      accountId: 'u-me',
      viewerKind: 'licensed' as const,
      loadCount: async () => 3,
    }),
    openViewModal: async () => undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    resetCommentsContext()
    // What the viewer publishes once its content has loaded.
    publishCommentsContext({ diagramId: 'cc-1', diagramVersion: 4, diagramTitle: 'Architecture overview', lastModifierId: 'u-editor', macroType: 'mermaid' })
    await userEvent.hover(await canvas.findByTestId('feedback-edge'))
    await expect(await canvas.findByRole('button', { name: 'Comments' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Report a bug' })).toBeVisible()
  },
}
