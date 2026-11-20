import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import type { App } from 'vue'
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
async function editable() {
  await waitFor(() => {
    expect(preview().querySelector('.mie-enabled svg[aria-roledescription="sequence"]')).not.toBeNull()
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
    return () => {
      forgeGlobal.forgeContext = previous
    }
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Double-click a participant label or a message text of a Mermaid sequence diagram in the editor preview and edit it where it is. The diagram re-lays out on every keystroke; the source is written once, on Enter or click away. Esc cancels.',
      },
    },
  },
}
export default meta

type Story = StoryObj<typeof Workspace>

/** No play function: try it by hand. */
export const TryByHand: Story = { decorators: decorate(SMALL) }

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
