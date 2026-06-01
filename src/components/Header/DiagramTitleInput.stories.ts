import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import DiagramTitleInput from './DiagramTitleInput.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { useAutoTitle } from '@/composables/useAutoTitle'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import EventBus from '@/EventBus'

type Story = StoryObj<typeof DiagramTitleInput>

const SAMPLE_CODE = `
Client->Server: submitPayment()
Server->DB: insert(payment)
DB-->Server: ok
Server-->Client: receipt
`.trim()

let _restoreFetch: (() => void) | null = null

function clearFetchMock() {
  _restoreFetch?.()
  _restoreFetch = null
}

function mockFetch(title: string, delayMs = 0, ok = true) {
  clearFetchMock()
  const original = window.fetch
  window.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('ai-generate-title')) {
      if (delayMs > 0) await new Promise<void>((r) => setTimeout(r, delayMs))
      return { ok, text: async () => (ok ? title : title) } as Response
    }
    return original(url, init)
  }
  _restoreFetch = () => {
    window.fetch = original
  }
}

function setupForge() {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
}

function setAiEnabled(enabled: boolean) {
  if (enabled) {
    localStorage.removeItem('mockAiTitleEnabled')
  } else {
    localStorage.setItem('mockAiTitleEnabled', 'false')
  }
}

function setupStore({
  code = '',
  title = '',
  diagramType = DiagramType.Sequence,
}: { code?: string; title?: string; diagramType?: DiagramType } = {}) {
  store.dispatch('updateDiagramType', diagramType)
  store.dispatch('updateCode2', code)
  store.dispatch('updateTitle', title)
}

const meta: Meta<typeof DiagramTitleInput> = {
  title: 'Header/DiagramTitleInput',
  component: DiagramTitleInput,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Title input for the diagram editor header. When the AI feature flag is enabled, a spark button appears that generates a title from the diagram code.',
      },
    },
  },
  decorators: [
    () => {
      clearFetchMock()
      setupForge()
      ;(useAutoTitle as any).__resetForTests?.()
      return {
        template: '<div class="p-4 bg-white w-full max-w-lg"><story /></div>',
      }
    },
  ],
}

export default meta

/** AI feature flag OFF — no spark button rendered. */
export const Default: Story = {
  decorators: [
    () => {
      setAiEnabled(false)
      setupStore()
      return { template: '<story />' }
    },
  ],
}

/** AI feature flag ON, no code yet — spark button is visible but auto-generate won't fire (empty code). */
export const AIEnabled: Story = {
  decorators: [
    () => {
      setAiEnabled(true)
      setupStore()
      return { template: '<story />' }
    },
  ],
}

/** Spark clicked while fetch is pending — button is disabled and spark pulses. */
export const Generating: Story = {
  decorators: [
    () => {
      setAiEnabled(true)
      setupStore({ code: SAMPLE_CODE })
      mockFetch('Payment Flow Sequence', 60_000)
      return { template: '<story />' }
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
      setAiEnabled(true)
      setupStore({ code: SAMPLE_CODE })
      mockFetch('Payment Flow Sequence', 0)
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const body = within(document.body)
    const sparkBtn = await body.findByTitle('Generate title with AI')
    await userEvent.click(sparkBtn)
    // 22 chars × 40 ms/char ≈ 880 ms; allow up to 3 s for CI
    await waitFor(
      () => {
        const input = body.getByPlaceholderText('Name your diagram…')
        expect(input).toHaveValue('Payment Flow Sequence')
      },
      { timeout: 3000 },
    )
    await expect(body.getByTitle('Dismiss suggested title')).toBeVisible()
  },
}

/** flash-title-error event turns the border red (e.g. save attempted with empty title). */
export const TitleError: Story = {
  decorators: [
    () => {
      setAiEnabled(false)
      setupStore({ title: 'My Diagram' })
      return { template: '<story />' }
    },
  ],
  play: async () => {
    EventBus.$emit('flash-title-error')
  },
}
