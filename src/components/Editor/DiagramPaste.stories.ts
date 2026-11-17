import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import type { App } from 'vue'
import { expect, waitFor, within } from 'storybook/test'
import { EditorView } from '@codemirror/view'
import Workspace from '@/components/Workspace.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import forgeGlobal from '@/model/globals/forgeGlobal'
import Example from '@/utils/sequence/Example'

// Workspace.vue reads the store through mapState and useStore(), so the Vuex
// plugin goes on Storybook's root app (see Header.stories.ts).
setup((app: App) => {
  app.use(store)
})

const BODY = `sequenceDiagram
  autonumber
  participant R as Robot
  participant GW as Gateway<br/>(edge)
  R->>GW: request credential
  alt ok
    GW-->>R: credential
  end`
// What "Copy" on a chat answer or a Markdown file gives: the fence comes along.
const FENCED = '```mermaid\n' + BODY + '\n```'

const AUTHORED_SEQUENCE = `// Checkout sequence
Client->OrderService.placeOrder(items) {
  return orderId
}`

const GALLERY_MARKER_PREFIX = 'zenuml.starterGalleryAutoOpened.'

function prepare({ diagramType, code = Example.Sequence, mermaidCode = Example.Mermaid }: {
  diagramType: DiagramType
  code?: string
  mermaidCode?: string
}) {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('zenuml.mcpPromo') || key.startsWith('zenuml.connectMcpShown')) localStorage.removeItem(key)
  }
  localStorage.removeItem('zenuml-preferred-diagram-type')
  // The starter gallery would cover the editor; these stories are about the paste.
  for (const type of [DiagramType.Sequence, DiagramType.Mermaid]) localStorage.setItem(`${GALLERY_MARKER_PREFIX}unknown-cloud.${type}`, '1')
  document.querySelectorAll('[data-testid="toast"]').forEach(node => node.remove())
  store.commit('updateDiagramType', diagramType)
  store.commit('updateCode2', code)
  store.commit('updateMermaidCode', mermaidCode)
  store.commit('updateTitle', 'Robot credential')
  store.commit('updateError', null)
  // A saved diagram: keeps the new-diagram MCP card off the preview.
  ;(store.state as any).diagram.id = '12345'
  ;(store.state as any).diagram.isNew = false
}

async function editorView(): Promise<EditorView> {
  let view: EditorView | null = null
  await waitFor(() => {
    const dom = document.querySelector('.cm-editor') as HTMLElement | null
    view = dom ? EditorView.findFromDOM(dom) : null
    expect(view).not.toBeNull()
  })
  return view!
}

// A real paste event on the editor, so CodeMirror runs its own paste path
// (userEvent "input.paste") exactly as a Cmd+V does. Replaces the whole
// document, like select-all then paste.
async function selectAllAndPaste(text: string) {
  const view = await editorView()
  view.focus()
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
  const clipboardData = new DataTransfer()
  clipboardData.setData('text/plain', text)
  view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
}

const diagramState = () => (store.state as any).diagram
// The validation debounce in Editor.vue is 1 s; wait past it before reading the error.
const afterValidation = () => new Promise(resolve => setTimeout(resolve, 1500))
const previewShowsRobot = () =>
  waitFor(() => expect(document.querySelector('#workspace-right svg')?.textContent).toContain('Robot'), { timeout: 10000 })

const meta: Meta<typeof Workspace> = {
  title: 'Editor/Diagram/DiagramPaste',
  component: Workspace,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Paste handling in the Sequence and Mermaid code editors: a Markdown code fence is removed at paste time, and Mermaid text pasted over the untouched Sequence starter goes to the Mermaid tab with an Undo.',
      },
    },
  },
  decorators: [() => ({ template: '<div style="height: 760px;"><story /></div>' })],
}
export default meta

type Story = StoryObj<typeof Workspace>

/** Mermaid tab: a fenced block is pasted; the fence is gone and the diagram draws. */
export const FencedPasteIntoMermaidTab: Story = {
  beforeEach: () => prepare({ diagramType: DiagramType.Mermaid }),
  play: async () => {
    await selectAllAndPaste(FENCED)
    await waitFor(() => expect(diagramState().mermaidCode).toBe(BODY))
    await previewShowsRobot()
    await afterValidation()
    await expect((store.state as any).error).toBeNull()
    await expect(document.querySelector('.cm-content')?.textContent).not.toContain('```')
  },
}

/** Sequence tab still on its starter: pasted Mermaid goes to the Mermaid tab, with an Undo. */
export const MermaidPasteIntoStarterSequenceTab: Story = {
  beforeEach: () => prepare({ diagramType: DiagramType.Sequence }),
  play: async () => {
    const canvas = within(document.body)
    await selectAllAndPaste(FENCED)
    await waitFor(() => expect(diagramState().diagramType).toBe(DiagramType.Mermaid))
    await expect(diagramState().mermaidCode).toBe(BODY)
    await expect(diagramState().code).toBe(Example.Sequence)
    await expect(await canvas.findByTestId('toast-action')).toHaveTextContent('Undo')
    await previewShowsRobot()
    await afterValidation()
    await expect((store.state as any).error).toBeNull()
  },
}

/** Undo on that toast: the paste is back in the Sequence tab and the hint offers the switch. */
export const UndoReturnsPasteToSequenceTab: Story = {
  beforeEach: () => prepare({ diagramType: DiagramType.Sequence }),
  play: async () => {
    const canvas = within(document.body)
    await selectAllAndPaste(FENCED)
    ;(await canvas.findByTestId('toast-action')).click()
    await waitFor(() => expect(diagramState().diagramType).toBe(DiagramType.Sequence))
    await expect(diagramState().code).toBe(BODY)
    await expect(diagramState().mermaidCode).toBe(Example.Mermaid)
    await expect(await canvas.findByTestId('foreign-dialect-hint')).toHaveTextContent('This looks like Mermaid')
    await expect(canvas.queryByTestId('toast')).toBeNull()
  },
}

/** Sequence tab with the author's own code: the paste stays, without its fence, and the hint shows. */
export const FencedPasteIntoAuthoredSequenceTab: Story = {
  beforeEach: () => prepare({ diagramType: DiagramType.Sequence, code: AUTHORED_SEQUENCE }),
  play: async () => {
    const canvas = within(document.body)
    await selectAllAndPaste(FENCED)
    await waitFor(() => expect(diagramState().code).toBe(BODY))
    await expect(diagramState().diagramType).toBe(DiagramType.Sequence)
    await expect(await canvas.findByTestId('foreign-dialect-hint')).toBeInTheDocument()
    await expect(canvas.queryByTestId('toast')).toBeNull()
  },
}

/** The hint's "Switch to Mermaid" on a source that still carries prose and a fence: only the diagram moves. */
export const HintSwitchDropsFence: Story = {
  beforeEach: () => prepare({ diagramType: DiagramType.Sequence, code: 'Here is the diagram:\n' + FENCED }),
  play: async () => {
    const canvas = within(document.body)
    ;(await canvas.findByTestId('foreign-dialect-switch')).click()
    await waitFor(() => expect(diagramState().diagramType).toBe(DiagramType.Mermaid))
    await expect(diagramState().mermaidCode).toBe(BODY)
    await previewShowsRobot()
    await afterValidation()
    await expect((store.state as any).error).toBeNull()
  },
}
