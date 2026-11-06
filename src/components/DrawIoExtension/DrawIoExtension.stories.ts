import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { App } from 'vue'
import DrawIoExtension from './DrawIoExtension.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { useAutoTitle } from '@/composables/useAutoTitle'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'

setup((app: App) => {
  app.use(store)
})

type Story = StoryObj<typeof DrawIoExtension>

const LABELLED_XML = `<mxGraphModel><root>
  <mxCell id="0" />
  <mxCell id="2" value="Login" vertex="1" />
  <mxCell id="3" value="Validate" vertex="1" />
  <mxCell id="4" value="Dashboard" vertex="1" />
</root></mxGraphModel>`

let _restoreFetch: (() => void) | null = null

function clearFetchMock() {
  _restoreFetch?.()
  _restoreFetch = null
}

function mockFetch(title: string, delayMs = 0, ok = true) {
  clearFetchMock()
  const original = window.fetch
  window.fetch = async (url: RequestInfo | URL) => {
    if (String(url).includes('ai-generate-title')) {
      if (delayMs > 0) await new Promise<void>((r) => setTimeout(r, delayMs))
      return { ok, text: async () => (ok ? title : title) } as Response
    }
    return original(url)
  }
  _restoreFetch = () => {
    window.fetch = original
  }
}

function setupForge() {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
}

function setupStore({ title = '' }: { title?: string } = {}) {
  store.commit('updateDiagramType', DiagramType.Graph)
  store.commit('updateTitle', title)
}

const overlayShell = {
  template: `
    <div
      style="position: relative; height: 120px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px;"
    >
      <story />
    </div>
  `,
}

const meta: Meta<typeof DrawIoExtension> = {
  title: 'Editor/Graph/DrawIoExtension',
  component: DrawIoExtension,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'DrawIO graph editor title overlay. Sits on the DrawIO menubar row (top-right), drives AI auto-title from live mxGraph XML, and exposes window.ensureTitle() for the publish path.',
      },
    },
  },
  args: {
    doc: {},
    currentXml: LABELLED_XML,
  },
  decorators: [
    () => {
      clearFetchMock()
      setupForge()
      ;(useAutoTitle as any).__resetForTests?.()
      return overlayShell
    },
  ],
}

export default meta

/** Empty Graph editor: no title yet. The spark button is always available (the ai-title rollout flag is gone). */
export const Default: Story = {
  decorators: [
    () => {
      setupStore()
      return overlayShell
    },
  ],
}

/** Existing title filled in — typical saved graph state. */
export const WithTitle: Story = {
  decorators: [
    () => {
      setupStore({ title: 'Order Flow' })
      return overlayShell
    },
  ],
}

/** Spark clicked while fetch is pending — button is disabled and spark pulses. */
export const Generating: Story = {
  decorators: [
    () => {
      setupStore()
      mockFetch('Order Flow', 60_000)
      return overlayShell
    },
  ],
  play: async () => {
    const body = within(document.body)
    const sparkBtn = await body.findByTitle('Generate title with AI')
    await userEvent.click(sparkBtn)
    await waitFor(() => expect(sparkBtn).toBeDisabled())
  },
}

/** Fetch returns immediately — typewriter animation finishes and dismiss button appears. */
export const Suggested: Story = {
  decorators: [
    () => {
      setupStore()
      mockFetch('Order Flow', 0)
      return overlayShell
    },
  ],
  play: async () => {
    const body = within(document.body)
    const sparkBtn = await body.findByTitle('Generate title with AI')
    await userEvent.click(sparkBtn)
    await waitFor(
      () => {
        const input = body.getByPlaceholderText('Name your graph…')
        expect(input).toHaveValue('Order Flow')
      },
      { timeout: 3000 },
    )
    await expect(body.getByTitle('Dismiss suggested title')).toBeVisible()
  },
}

/** One short label: the AI button uses it as the title and the model is not called. */
export const SingleLabel: Story = {
  args: {
    currentXml:
      '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Control" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>',
  },
  decorators: [
    () => {
      setupStore()
      mockFetch('Please provide the DSL describing the flowchart diagram.', 0)
      return overlayShell
    },
  ],
  play: async () => {
    const body = within(document.body)
    const input = body.getByPlaceholderText('Name your graph…')
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await expect(input).toHaveValue('')
    await userEvent.click(await body.findByTitle('Generate title with AI'))
    await waitFor(() => expect(input).toHaveValue('Control'))
  },
}

/** The model answers with a request for more input: the title stays empty. */
export const ModelRefusal: Story = {
  decorators: [
    () => {
      setupStore()
      mockFetch("Please provide the DSL describing the flowchart diagram. I'll help you create a", 0)
      return overlayShell
    },
  ],
  play: async () => {
    const body = within(document.body)
    const input = body.getByPlaceholderText('Name your graph…')
    await userEvent.click(await body.findByTitle('Generate title with AI'))
    await waitFor(() => expect(body.getByTitle('Generate title with AI')).toBeEnabled())
    await new Promise((resolve) => setTimeout(resolve, 500))
    await expect(input).toHaveValue('')
  },
}

/** ensureTitle() with an empty title surfaces the publish validation error state. */
export const TitleError: Story = {
  decorators: [
    () => {
      setupStore()
      return overlayShell
    },
  ],
  play: async () => {
    await waitFor(() => expect(typeof window.ensureTitle).toBe('function'))
    void window.ensureTitle?.()
    const body = within(document.body)
    await waitFor(() => {
      expect(body.getByPlaceholderText('Name your graph…')).toHaveClass('text-red-700')
    })
  },
}
