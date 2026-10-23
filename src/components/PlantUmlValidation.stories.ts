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

// A page view mounts the viewer with its source already loaded. The server SVG
// must be on screen as soon as validation returns, not 500 ms later: that
// debounce is for keystrokes in the editor, and a viewer has none.
export const FirstMountPaintsWithoutEditDebounce: Story = {
  render: () => ({
    components: { PlantUml },
    setup() {
      const code = '@startuml\nAlice -> Bob: First paint probe 20261024\n@enduml'
      store.commit('updatePlantUmlCode', code)
      store.commit('updateDiagramType', DiagramType.PlantUml)
      store.commit('updateError', null)

      const originalFetch = window.fetch
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith('https://www.plantuml.com/plantuml/svg/')) {
          return Promise.resolve(new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="322px" height="60px" viewBox="0 0 322 60">' +
            '<text x="10" y="30">First paint probe 20261024</text></svg>',
            { status: 200, headers: { 'Content-Type': 'image/svg+xml' } },
          ))
        }
        return originalFetch(input, init)
      }) as typeof fetch
      onBeforeUnmount(() => { window.fetch = originalFetch })
      return {}
    },
    template: '<div class="p-6"><PlantUml /></div>',
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Well under the 500 ms edit debounce: validation + render share one
    // already-resolved fetch, so only microtasks and a Vue tick remain.
    await new Promise((resolve) => setTimeout(resolve, 100))
    await expect(canvas.getByText('First paint probe 20261024')).toBeVisible()
  },
}
