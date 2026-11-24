import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MERMAID_SOURCE_SELECTION,
  type MermaidSourceSelection,
} from '@/features/mermaidInlineEdit/ui/surface'
import { mermaidSourceSelection } from './mermaidSourceSelection'

describe('Mermaid source selection', () => {
  const source = 'flowchart LR\nA[Same] --> B[Same]'
  const from = source.lastIndexOf('Same')
  const to = from + 'Same'.length
  const events: MermaidSourceSelection[] = []
  const record = (event: Event) => events.push((event as CustomEvent<MermaidSourceSelection>).detail)
  let workspace: HTMLElement
  let view: EditorView

  beforeEach(() => {
    workspace = document.createElement('div')
    workspace.className = 'workspace-container'
    document.body.append(workspace)
    window.addEventListener(MERMAID_SOURCE_SELECTION, record)
    view = new EditorView({
      parent: workspace,
      state: EditorState.create({
        doc: source,
        extensions: [mermaidSourceSelection, EditorState.allowMultipleSelections.of(true)],
      }),
    })
    view.focus()
  })

  afterEach(() => {
    view.destroy()
    workspace.remove()
    window.removeEventListener(MERMAID_SOURCE_SELECTION, record)
    events.length = 0
  })

  it('publishes the exact selected occurrence and keeps focus and selection', () => {
    view.dispatch({ selection: { anchor: to, head: from } })
    expect(events).toEqual([{ owner: workspace, code: source, from, to, typing: false }])
    expect(view.state.selection.main).toMatchObject({ anchor: to, head: from })
    expect(view.hasFocus).toBe(true)
  })

  it('maps a selection through replacement typing and clears on a later caret move', () => {
    view.dispatch({ selection: { anchor: from, head: to } })
    view.dispatch({
      changes: { from, to, insert: 'New' },
      selection: { anchor: from + 3 },
      userEvent: 'input.type',
    })
    expect(events.at(-1)).toEqual({
      owner: workspace,
      code: source.slice(0, from) + 'New]',
      from,
      to: from + 3,
      typing: true,
    })
    view.dispatch({
      changes: { from: from + 3, insert: ' label' },
      selection: { anchor: from + 9 },
      userEvent: 'input.type',
    })
    expect(events.at(-1)).toMatchObject({
      code: source.slice(0, from) + 'New label]',
      from,
      to: from + 9,
      typing: true,
    })
    view.dispatch({ selection: { anchor: from + 2 }, userEvent: 'select' })
    expect(events.at(-1)).toMatchObject({ from: 0, to: 0, typing: false })
  })

  it('clears on multiline and multiple selections', () => {
    const selectLabel = () => view.dispatch({ selection: { anchor: from, head: to } })
    selectLabel()
    view.dispatch({ selection: { anchor: 0, head: to } })
    expect(events.at(-1)).toMatchObject({ from: 0, to: 0 })
    selectLabel()
    view.dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.range(from, to)]),
    })
    expect(events.at(-1)).toMatchObject({ from: 0, to: 0 })
  })

  it('clears on changes that did not come from source typing', () => {
    view.dispatch({ selection: { anchor: from, head: to } })
    view.dispatch({ changes: { from, to, insert: 'Changed elsewhere' } })
    expect(events.at(-1)).toMatchObject({ from: 0, to: 0, typing: false })
  })

  it('clears when focus moves away from the source editor', async () => {
    view.dispatch({ selection: { anchor: from, head: to } })
    const other = document.createElement('button')
    workspace.append(other)
    other.focus()
    await vi.waitFor(() => {
      expect(events.at(-1)).toMatchObject({ from: 0, to: 0, typing: false })
    })
  })
})
