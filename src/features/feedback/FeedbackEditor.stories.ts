import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'

import Workspace from '@/components/Workspace.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DiagramType } from '@/model/Diagram/Diagram'
import FeedbackHost from './FeedbackHost.vue'
import { storyFeedbackContext } from './feedbackStoryFixtures'

setup((app) => app.use(store))

function configureEditor() {
  store.commit('updateDiagramType', DiagramType.Sequence)
  store.commit('updateCode2', 'Client->Service: Request\nService-->Client: Response')
  store.commit('updateTitle', 'Request flow')
  forgeGlobal.isForge = false
  forgeGlobal.forgeContext = {
    moduleKey: 'zenuml-sequence-macro-lite',
    extension: { modal: { macroMode: 'editor' }, macro: { isConfiguring: true } },
  }
  globals.apWrapper.canUserEdit = async () => true
}

type Story = StoryObj<typeof FeedbackHost>
const meta: Meta<typeof FeedbackHost> = {
  title: 'Editor/Diagram/FeedbackEditor',
  component: FeedbackHost,
  parameters: { layout: 'fullscreen' },
  args: { context: storyFeedbackContext('editor') },
  render: (args) => {
    configureEditor()
    return {
      components: { Workspace, FeedbackHost },
      setup: () => ({ args }),
      template: '<Workspace /><FeedbackHost v-bind="args" />',
    }
  },
}
export default meta

export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.hover(canvas.getByTestId('feedback-edge'))
    await userEvent.click(canvas.getByRole('button', { name: 'Send feedback' }))
    await expect(canvas.getByRole('dialog', { name: 'Send feedback' })).toBeVisible()
  },
}
