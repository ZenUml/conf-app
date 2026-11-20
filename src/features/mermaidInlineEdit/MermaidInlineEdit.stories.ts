import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import type { App } from 'vue'
import { expect, userEvent, waitFor } from 'storybook/test'
import Workspace from '@/components/Workspace.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { REJECTION_MESSAGES } from './ui/copy'

// Mermaid sequence inline edit, on the real editor preview: full Workspace,
// real Mermaid render, real position parser, flag on through the standalone
// localStorage mock (mockMermaidInlineEditEnabled).
setup((app: App) => {
  app.use(store)
})

const SEQUENCE = `sequenceDiagram
  participant A as Alice
  participant Bob
  A->>Bob: Hello<br/>two lines
  Bob-->>A: Fine`

function prepare(code: string) {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
  localStorage.setItem('mockMermaidInlineEditEnabled', 'true')
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
const input = () => document.querySelector('[data-testid="mermaid-inline-edit-input"]') as HTMLInputElement | null

/** Wait until the preview is editable (map computed for the code on screen). */
async function editable() {
  await waitFor(() => {
    expect(preview().querySelector('.mie-enabled svg[aria-roledescription="sequence"]')).not.toBeNull()
  }, { timeout: 15_000 })
}

function participant(id: string): Element {
  const el = Array.from(preview().querySelectorAll('svg [data-et="participant"]')).find(e => e.getAttribute('data-id') === id)
  if (!el) throw new Error(`participant ${id} not rendered`)
  return el
}

function messageText(index: number): Element {
  const el = preview().querySelector(`svg [data-seq-for="i${index}"]`)
  if (!el) throw new Error(`message i${index} not tagged`)
  return el
}

const decorators = [() => {
  prepare(SEQUENCE)
  return { template: '<div style="height: 760px;"><story /></div>' }
}]

const meta: Meta<typeof Workspace> = {
  title: 'Editor/Diagram/MermaidInlineEdit',
  component: Workspace,
  // Standalone has no Forge context, which reads as display mode. The editor
  // modal says macroMode 'editor', and the inline-edit gate requires it.
  // Restored afterwards so later stories in the same preview are unaffected.
  // Note: the store's isDisplayMode getter caches its first value per page
  // load, so open this story on a fresh load (or reload) if a viewer story ran first.
  beforeEach: () => {
    const previous = forgeGlobal.forgeContext
    const context = (previous ?? {}) as any
    forgeGlobal.forgeContext = { ...context, extension: { ...context.extension, modal: { macroMode: 'editor' } } } as any
    return () => {
      forgeGlobal.forgeContext = previous
      localStorage.removeItem('mockMermaidInlineEditEnabled')
    }
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Double-click a participant name or a message text of a Mermaid sequence diagram in the editor preview to edit it in place. Enter or blur saves, Esc cancels. Flag: mermaid-inline-edit-enabled.',
      },
    },
  },
}
export default meta

type Story = StoryObj<typeof Workspace>

/** Rename an aliased participant: the alias changes in the source. */
export const RenameParticipant: Story = {
  decorators,
  play: async () => {
    await editable()
    await userEvent.dblClick(participant('A').querySelector('text') ?? participant('A'))
    await waitFor(() => expect(input()?.value).toBe('Alice'))
    await userEvent.clear(input()!)
    await userEvent.type(input()!, 'Alicia{Enter}')
    await waitFor(() => expect(code()).toContain('participant A as Alicia'))
    expect(input()).toBeNull()
  },
}

/** A message with <br/> shows its SOURCE text in the box, not the rendered lines. */
export const EditMessageWithLineBreak: Story = {
  decorators,
  play: async () => {
    await editable()
    await userEvent.dblClick(messageText(0))
    await waitFor(() => expect(input()?.value).toBe('Hello<br/>two lines'))
    await userEvent.clear(input()!)
    await userEvent.type(input()!, 'Hi there{Enter}')
    await waitFor(() => expect(code()).toContain('A->>Bob: Hi there'))
  },
}

/** Renaming to a name that is already used is refused with a toast. */
export const DuplicateNameToast: Story = {
  decorators,
  play: async () => {
    await editable()
    const before = code()
    await userEvent.dblClick(participant('Bob'))
    await waitFor(() => expect(input()).not.toBeNull())
    await userEvent.clear(input()!)
    await userEvent.type(input()!, 'A{Enter}')
    await waitFor(() => {
      const toast = document.querySelector('[data-testid="toast"]')
      expect(toast?.textContent).toBe(REJECTION_MESSAGES.name_exists)
    })
    expect(code()).toBe(before)
  },
}

/** Esc closes the box and leaves the source as it was. */
export const EscCancels: Story = {
  decorators,
  play: async () => {
    await editable()
    const before = code()
    await userEvent.dblClick(messageText(1))
    await waitFor(() => expect(input()?.value).toBe('Fine'))
    await userEvent.type(input()!, ' and more{Escape}')
    await waitFor(() => expect(input()).toBeNull())
    expect(code()).toBe(before)
  },
}
