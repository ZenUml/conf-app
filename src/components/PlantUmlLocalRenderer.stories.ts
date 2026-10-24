import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { expect, waitFor, within } from 'storybook/test'
import { onBeforeUnmount } from 'vue'
import PlantUml from './PlantUml.vue'
import SyntaxErrorBox from './SyntaxErrorBox.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import { PLANTUML_RENDERER_STORAGE_KEY } from '@/utils/plantuml/renderer'

setup((app) => app.use(store))

/**
 * ADR-0010 spike: PlantUML drawn by the real @plantuml/core engine in this
 * browser. Unlike the other PlantUML stories nothing is canned: any request to
 * plantuml.com is refused and recorded, and each play asserts there was none.
 */
const meta: Meta = {
  title: 'Editor/Diagram/PlantUmlLocalRenderer',
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof meta>

const serverCalls: string[] = []

function localRendererStory(code: string) {
  return () => ({
    components: { PlantUml, SyntaxErrorBox },
    setup() {
      localStorage.setItem(PLANTUML_RENDERER_STORAGE_KEY, 'local')
      serverCalls.length = 0
      const originalFetch = window.fetch
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url.includes('plantuml.com')) {
          serverCalls.push(url)
          return Promise.reject(new TypeError('plantuml.com is blocked in this story'))
        }
        return originalFetch(input, init)
      }) as typeof fetch
      onBeforeUnmount(() => {
        window.fetch = originalFetch
        localStorage.removeItem(PLANTUML_RENDERER_STORAGE_KEY)
      })
      store.commit('updateError', null)
      store.commit('updatePlantUmlCode', code)
      store.commit('updateDiagramType', DiagramType.PlantUml)
      return {}
    },
    template: '<div class="p-6" style="height: 480px"><PlantUml /><SyntaxErrorBox /></div>',
  })
}

async function expectDrawnWithoutServer(canvasElement: HTMLElement, label: string) {
  await waitFor(() => expect(canvasElement.querySelector('.plantuml-render svg')).not.toBeNull(), { timeout: 30000 })
  await expect(canvasElement.querySelector('.plantuml-render svg')!.textContent).toContain(label)
  await expect(serverCalls).toEqual([])
}

export const SequenceDiagram: Story = {
  render: localRendererStory('@startuml\nAlice -> Bob: Hello from the local engine\nBob --> Alice: No server involved\n@enduml'),
  play: async ({ canvasElement }) => expectDrawnWithoutServer(canvasElement, 'Hello from the local engine'),
}

/** Needs a Graphviz layout: drawn by Smetana, since viz-global.js is not loaded. */
export const ClassDiagram: Story = {
  render: localRendererStory('@startuml\nclass Order {\n  +id: UUID\n  +total(): Money\n}\nclass LineItem\nOrder "1" *-- "many" LineItem : contains\nCustomer --> Order : places\n@enduml'),
  play: async ({ canvasElement }) => expectDrawnWithoutServer(canvasElement, 'LineItem'),
}

/** The engine's error drawing feeds the existing SyntaxErrorBox, line number included. */
export const SyntaxError: Story = {
  render: localRendererStory('@startuml\nAlice -> Bob: fine\nfoo bar baz ->>> \n@enduml'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText(/line 3/)).toBeTruthy(), { timeout: 30000 })
    await expect(serverCalls).toEqual([])
  },
}

/** Known gap until the stdlib is self-hosted: an !include library fails visibly. */
export const IncludeUnavailable: Story = {
  render: localRendererStory('@startuml\n!include <C4/C4_Context>\nPerson(user, "User")\n@enduml'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText(/!include library/)).toBeTruthy(), { timeout: 30000 })
    await expect(serverCalls).toEqual([])
  },
}
