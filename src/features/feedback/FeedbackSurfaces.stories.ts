import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { userEvent, within } from 'storybook/test'
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
  title: 'Fullscreen/Feedback',
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

export const Open: Story = { play: async ({ canvasElement }) => revealAndOpen(canvasElement) }
