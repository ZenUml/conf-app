import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import type { App } from 'vue'
import { EditorView } from '@codemirror/view'
import { expect, userEvent, waitFor } from 'storybook/test'
import Workspace from '@/components/Workspace.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { REJECTION_MESSAGES } from './ui/copy'

// Mermaid sequence inline edit on the real editor preview: full Workspace,
// real Mermaid render, real position parser. Double-click a message text or a
// participant label (top box or bottom mirror) and type where it is: the
// diagram re-lays out live, the code panel changes only on Enter or click
// away. Shift+Enter adds a line, Esc cancels. Invalid text (a name that
// exists, empty, characters Mermaid can't use) turns the outline red with a
// hint, and the last valid picture stays.
setup((app: App) => {
  app.use(store)
})

// Participants: A (aliased "Alice"), Bob (no alias: the id is the label),
// Carol (aliased), Bo (no alias; type "b" to make it "Bob" and collide).
const SMALL = `sequenceDiagram
  participant A as Alice
  participant Bob
  participant C as Carol
  participant Bo
  A->>Bob: Hi
  Bob->>C: Hello<br/>two lines
  C-->>A: Fine
  Bo->>A: Ping`

const REPEATED_MESSAGES = `sequenceDiagram
  Alice->>Bob: Repeat
  Alice->>Bob: Repeat`

function large(): string {
  const names = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy']
  const lines = ['sequenceDiagram', ...names.map((n) => `  participant ${n}`)]
  for (let i = 0; i < 50; i += 1) {
    const from = names[i % names.length]
    const to = names[(i * 3 + 1) % names.length]
    lines.push(`  ${from}->>${to === from ? names[(i + 1) % names.length] : to}: message ${i + 1}`)
  }
  return lines.join('\n')
}

// Flowchart: several shapes, a bare-id node (D), pipe and inline edge labels,
// a <br/> label.
const FLOW = `flowchart LR
  A[Start] -->|yes| B(Round label)
  B -- inline text --> C{Decide}
  C --> D
  C ==>|thick| E([Stadium])
  E -.-> F[[Sub routine]]
  F --> G[(Database)]
  G --> H[line one<br/>line two]`

// Read-only mix: markdown label, shared edge label (G & H), unlabeled edge,
// linked node. Only A, B, C and the "ok" edge are editable.
const FLOW_READ_ONLY = `flowchart TD
  A[Plain] -->|ok| B["\`**markdown** label\`"]
  G[Left] & H[Right] -->|shared| C[Target]
  C --> D[Linked]
  click D href "https://example.com"`

/** ~50 nodes in a binary tree with labelled edges, for the slow-render guard. */
function largeFlow(n = 50): string {
  const lines = ['flowchart TD']
  for (let i = 0; i < n; i += 1) lines.push(`  N${i}[Node number ${i}]`)
  for (let i = 1; i < n; i += 1) {
    lines.push(`  N${Math.floor((i - 1) / 2)} -->|e${i}| N${i}`)
    if (i % 5 === 0 && i > 3) lines.push(`  N${i} --> N${i - 3}`)
  }
  return lines.join('\n')
}

// Handle for the measurement harness and by-hand inspection.
;(window as any).__mieStore = store

function prepare(code: string) {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
  for (const t of [DiagramType.Sequence, DiagramType.Mermaid, DiagramType.PlantUml]) {
    localStorage.setItem(`zenuml.starterGalleryAutoOpened.unknown-cloud.${t}`, '1')
  }
  ;(store.state as any).diagram.id = 'mermaid-inline-edit-story'
  ;(store.state as any).diagram.isNew = false
  store.commit('updateTitle', 'Inline edit')
  store.commit('updateMermaidCode', code)
  store.commit('updateDiagramType', DiagramType.Mermaid)
}

const preview = () => document.querySelector('#workspace-right') as HTMLElement
const code = () => (store.state as any).diagram.mermaidCode as string
const layer = () => document.querySelector('[data-testid="mermaid-inline-edit-layer"]') as HTMLElement | null
const hint = () => document.querySelector('[data-testid="mermaid-inline-edit-hint"]') as HTMLElement | null

/** Wait until the preview is editable (map computed for the code on screen). */
async function editable(roledescription = 'sequence') {
  await waitFor(() => {
    expect(preview().querySelector(`.mie-enabled svg[aria-roledescription="${roledescription}"]`)).not.toBeNull()
  }, { timeout: 15_000 })
}

function headerText(id: string): Element {
  const el = Array.from(preview().querySelectorAll('svg [data-et="participant"]')).find(e => e.getAttribute('data-id') === id)
  if (!el) throw new Error(`participant ${id} not rendered`)
  return el.querySelector('text') ?? el
}

function messageText(index: number): Element {
  const el = preview().querySelector(`svg [data-seq-for="i${index}"]`)
  if (!el) throw new Error(`message i${index} not tagged`)
  return el
}

/**
 * Replace the layer's whole text: select all, then insert through the
 * browser's own editing commands, which fire the same input event a keystroke
 * does. userEvent.keyboard typing did not change this contenteditable layer
 * here, so it is not used for text. A "\n" becomes insertLineBreak, the
 * command Shift+Enter runs natively. Real keystrokes are covered by the unit
 * tests and the Playwright harness.
 */
async function retype(text: string) {
  const el = layer()!
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  text.split('\n').forEach((part, i) => {
    if (i > 0) document.execCommand('insertLineBreak')
    if (part) document.execCommand('insertText', false, part)
  })
}

const svgRoot = () => preview().querySelector('.diagram-viewport-content svg') as SVGSVGElement

/** A flowchart node's label element (found by node id; the svg id changes on every render). */
function flowNode(id: string): HTMLElement {
  const root = svgRoot()
  const g = Array.from(root.querySelectorAll('g.node')).find(e => new RegExp(`^${root.id}-flowchart-${id}-\\d+$`).test(e.id))
  const label = g?.querySelector('span.nodeLabel p') ?? g?.querySelector('span.nodeLabel')
  if (!label) throw new Error(`node ${id} not rendered`)
  return label as HTMLElement
}

/** A flowchart edge label element by its db edge id (`L_A_B_0`). */
function flowEdge(edgeId: string): HTMLElement {
  const g = Array.from(svgRoot().querySelectorAll('g.edgeLabel g.label[data-id]')).find(e => e.getAttribute('data-id') === edgeId)
  const label = g?.querySelector('span.edgeLabel p') ?? g?.querySelector('span.edgeLabel')
  if (!label) throw new Error(`edge ${edgeId} not rendered`)
  return label as HTMLElement
}

const decorate = (source: string) => [() => {
  prepare(source)
  return { template: '<div style="height: 760px;"><story /></div>' }
}]

const meta: Meta<typeof Workspace> = {
  title: 'Editor/Diagram/MermaidInlineEdit',
  component: Workspace,
  // Standalone has no Forge context, which reads as display mode. The editor
  // modal says macroMode 'editor', and the inline-edit gate requires it.
  // Restored afterwards so later stories in the same preview are unaffected.
  // Note: the store's isDisplayMode getter caches its first value per page
  // load, so open these stories on a fresh load if a viewer story ran first.
  beforeEach: () => {
    const previous = forgeGlobal.forgeContext
    const context = (previous ?? {}) as any
    forgeGlobal.forgeContext = { ...context, extension: { ...context.extension, modal: { macroMode: 'editor' } } } as any
    // The editor entry (forgeIndex.ts) sets window.split; Workspace creates the
    // drag bar between the code pane and the preview only when it is set.
    const previousSplit = (window as any).split
    ;(window as any).split = true
    return () => {
      forgeGlobal.forgeContext = previous
      ;(window as any).split = previousSplit
    }
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Double-click a participant label or a message text of a Mermaid sequence diagram, or a node label or an edge label of a flowchart, in the editor preview and edit it where it is. The diagram re-lays out while you type; the source is written once, on Enter or click away. Esc cancels.',
      },
    },
  },
}
export default meta

type Story = StoryObj<typeof Workspace>

/** No play function: try it by hand. */
export const TryByHand: Story = { decorators: decorate(SMALL) }

export const SourceSelectionHint: Story = {
  decorators: decorate(REPEATED_MESSAGES),
  play: async ({ canvasElement }) => {
    await editable()
    const editor = canvasElement.querySelector<HTMLElement>('.cm-editor')
    const view = editor && EditorView.findFromDOM(editor)
    if (!view) throw new Error('CodeMirror source editor not found')

    const ring = () => preview().querySelector<HTMLElement>('[data-testid="mermaid-source-selection-ring"]')
    const sourceHint = () => preview().querySelector<HTMLElement>('[data-testid="mermaid-source-selection-hint"]')
    const assertSecondMessageHighlighted = () => {
      const bounds = ring()?.getBoundingClientRect()
      if (!bounds) throw new Error('Source selection ring not found')
      const centerY = (bounds.top + bounds.bottom) / 2
      const second = messageText(1).getBoundingClientRect()
      const first = messageText(0).getBoundingClientRect()
      expect(centerY).toBeGreaterThan(second.top)
      expect(centerY).toBeLessThan(second.bottom)
      expect(centerY).toBeGreaterThan(first.bottom)
    }

    const first = REPEATED_MESSAGES.indexOf('Repeat')
    const second = REPEATED_MESSAGES.lastIndexOf('Repeat')
    const select = (anchor: number, head: number) => view.dispatch({ selection: { anchor, head } })
    view.focus()
    select(second, second + 'Repeat'.length)
    await waitFor(() => {
      expect(sourceHint()).toBeVisible()
      expect(sourceHint()?.textContent).toBe('You can also double-click here to edit.')
      assertSecondMessageHighlighted()
    })
    expect(view.hasFocus).toBe(true)
    expect(view.state.selection.main).toMatchObject({ from: second, to: second + 'Repeat'.length })

    document.execCommand('insertText', false, 'Updated')
    await waitFor(() => {
      expect(code()).toBe(REPEATED_MESSAGES.slice(0, second) + 'Updated')
      expect(messageText(0).textContent).toBe('Repeat')
      expect(messageText(1).textContent).toBe('Updated')
      assertSecondMessageHighlighted()
    })
    expect(view.hasFocus).toBe(true)

    select(first, second + 'Updated'.length)
    await waitFor(() => {
      expect(ring()).toBeNull()
      expect(sourceHint()).toBeNull()
    })
    select(second, second + 'Updated'.length)
    await waitFor(() => expect(sourceHint()).toBeVisible())
    await userEvent.dblClick(messageText(1))
    await waitFor(() => {
      expect(layer()?.textContent).toBe('Updated')
      expect(ring()).toBeNull()
      expect(sourceHint()).toBeNull()
    })
  },
}

/** 10 participants, 50 messages: live re-layout on a larger diagram. */
export const LargeDiagram: Story = { decorators: decorate(large()) }

/** Rename a participant without alias: the id changes everywhere, live, then once in the source. */
export const RenameParticipant: Story = {
  decorators: decorate(SMALL),
  play: async () => {
    await editable()
    const before = code()
    await userEvent.dblClick(headerText('Bob'))
    await waitFor(() => expect(layer()?.textContent).toBe('Bob'))
    await retype('Robert')
    await waitFor(() => expect(preview().querySelector('svg [data-et="participant"][data-id="Robert"]')).not.toBeNull())
    expect(code()).toBe(before)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(code()).toContain('participant Robert'))
    expect(code()).toContain('A->>Robert: Hi')
    await waitFor(() => expect(layer()).toBeNull())
  },
}

/**
 * A message with <br/> shows its lines in the layer; a line break (what
 * Shift+Enter inserts) becomes <br/> in the source.
 */
export const EditMessageWithLineBreak: Story = {
  decorators: decorate(SMALL),
  play: async () => {
    await editable()
    await userEvent.dblClick(messageText(1))
    await waitFor(() => expect(layer()?.textContent).toBe('Hello\ntwo lines'))
    await retype('Hi\nthere')
    await waitFor(() => {
      const lines = Array.from(preview().querySelectorAll('svg [data-seq-for="i1"]')).map(e => e.textContent)
      expect(lines).toEqual(['Hi', 'there'])
    })
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(code()).toContain('Bob->>C: Hi<br/>there'))
  },
}

/** A name that is already used: red outline and hint, Enter stays in edit, nothing written. */
export const DuplicateNameInvalid: Story = {
  decorators: decorate(SMALL),
  play: async () => {
    await editable()
    const before = code()
    await userEvent.dblClick(headerText('Bo'))
    await waitFor(() => expect(layer()?.textContent).toBe('Bo'))
    await retype('Bob')
    await waitFor(() => expect(hint()?.textContent).toBe(REJECTION_MESSAGES.name_exists))
    expect(layer()!.classList.contains('mie-invalid')).toBe(true)
    await userEvent.keyboard('{Enter}')
    expect(layer()).not.toBeNull()
    expect(code()).toBe(before)
  },
}

/** Esc closes the layer, puts the stored picture back and leaves the source as it was. */
export const EscCancels: Story = {
  decorators: decorate(SMALL),
  play: async () => {
    await editable()
    const before = code()
    await userEvent.dblClick(messageText(2))
    await waitFor(() => expect(layer()?.textContent).toBe('Fine'))
    await retype('Fine and more')
    await waitFor(() => expect(messageText(2).textContent).toBe('Fine and more'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(layer()).toBeNull())
    await waitFor(() => expect(messageText(2).textContent).toBe('Fine'))
    expect(code()).toBe(before)
  },
}

/** Flowchart, by hand: shapes, a bare-id node (D), pipe and inline edge labels. */
export const FlowchartTryByHand: Story = { decorators: decorate(FLOW) }

/** Read-only mix: double-clicks on the markdown label, the shared edge label and the linked node do nothing. */
export const FlowchartReadOnlyMix: Story = {
  decorators: decorate(FLOW_READ_ONLY),
  play: async () => {
    await editable('flowchart-v2')
    const before = code()
    for (const el of [flowNode('B'), flowNode('D'), flowEdge('L_G_C_0'), flowEdge('L_H_C_0')]) {
      await userEvent.dblClick(el)
      expect(layer()).toBeNull()
    }
    expect(code()).toBe(before)
    // The plain node next to them is editable.
    await userEvent.dblClick(flowNode('A'))
    await waitFor(() => expect(layer()?.textContent).toBe('Plain'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(layer()).toBeNull())
  },
}

/** ~50 nodes: renders are slow enough that previews wait for a typing pause (slow-render guard). */
export const FlowchartLarge: Story = { decorators: decorate(largeFlow()) }

/** Edit a node label: live re-layout, the source is written on Enter. */
export const FlowchartEditNode: Story = {
  decorators: decorate(FLOW),
  play: async () => {
    await editable('flowchart-v2')
    const before = code()
    await userEvent.dblClick(flowNode('B'))
    await waitFor(() => expect(layer()?.textContent).toBe('Round label'))
    await retype('A much longer round label')
    await waitFor(() => expect(flowNode('B').textContent).toBe('A much longer round label'))
    expect(code()).toBe(before)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(code()).toBe(before.replace('B(Round label)', 'B(A much longer round label)')))
    await waitFor(() => expect(layer()).toBeNull())
  },
}

/** Edit an edge label: the pipe form stays. */
export const FlowchartEditEdge: Story = {
  decorators: decorate(FLOW),
  play: async () => {
    await editable('flowchart-v2')
    const before = code()
    await userEvent.dblClick(flowEdge('L_A_B_0'))
    await waitFor(() => expect(layer()?.textContent).toBe('yes'))
    await retype('yes please')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(code()).toBe(before.replace('-->|yes|', '-->|yes please|')))
  },
}

/** A node that shows its id: the edit inserts `[text]` after it. */
export const FlowchartBareIdNode: Story = {
  decorators: decorate(FLOW),
  play: async () => {
    await editable('flowchart-v2')
    const before = code()
    await userEvent.dblClick(flowNode('D'))
    await waitFor(() => expect(layer()?.textContent).toBe('D'))
    await retype('Done')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(code()).toBe(before.replace('C --> D', 'C --> D[Done]')))
  },
}

/** Esc leaves the source as it was and puts the stored picture back. */
export const FlowchartEscCancels: Story = {
  decorators: decorate(FLOW),
  play: async () => {
    await editable('flowchart-v2')
    const before = code()
    await userEvent.dblClick(flowNode('A'))
    await waitFor(() => expect(layer()?.textContent).toBe('Start'))
    await retype('Begin here')
    await waitFor(() => expect(flowNode('A').textContent).toBe('Begin here'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(layer()).toBeNull())
    await waitFor(() => expect(flowNode('A').textContent).toBe('Start'))
    expect(code()).toBe(before)
  },
}
