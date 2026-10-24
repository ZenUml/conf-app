import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import { onBeforeUnmount } from 'vue'
import PlantUml from './PlantUml.vue'
import SyntaxErrorBox from './SyntaxErrorBox.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'

setup((app) => app.use(store))

const meta: Meta = {
  title: 'Editor/Diagram/PlantUmlValidation',
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof meta>

export const SwitchingToMermaidIgnoresPendingError: Story = {
  render: () => ({
    components: { PlantUml, SyntaxErrorBox },
    setup() {
      const code = '@startuml\nAlice -> Bob: Stale validation probe 20261019\n@enduml'
      store.commit('updatePlantUmlCode', code)
      store.commit('updateMermaidCode', 'flowchart TD\nA-->B')
      store.commit('updateDiagramType', DiagramType.PlantUml)
      store.commit('updateError', null)

      const originalFetch = window.fetch
      let completeValidation: ((response: Response) => void) | undefined
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith('https://www.plantuml.com/plantuml/svg/')) {
          return new Promise<Response>((resolve) => { completeValidation = resolve })
        }
        return originalFetch(input, init)
      }) as typeof fetch
      onBeforeUnmount(() => { window.fetch = originalFetch })

      const switchToMermaid = () => {
        if (!completeValidation) throw new Error('PlantUML validation did not start')
        store.commit('updateDiagramType', DiagramType.Mermaid)
        completeValidation(new Response(
          '<svg>[From string (line 2)] Syntax Error? (Assumed diagram type: sequence)</svg>',
          { status: 400, headers: { 'Content-Type': 'image/svg+xml' } },
        ))
      }
      return { switchToMermaid }
    },
    template: '<div class="p-6"><button type="button" @click="switchToMermaid">Switch to Mermaid</button><PlantUml /><SyntaxErrorBox /></div>',
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Switch to Mermaid' }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    await expect(canvas.queryByText('Syntax error')).toBeNull()
  },
}
