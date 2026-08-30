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
  title: 'Editors/DrawIoExtension',
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

/** Empty Graph editor state. */
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

/** Labelled shapes in currentXml. */
export const AIEnabled: Story = {
  decorators: [
    () => {
      setupStore()
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
