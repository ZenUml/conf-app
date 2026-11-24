import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

import { MERMAID_SOURCE_SELECTION, type MermaidSourceSelection } from '@/features/mermaidInlineEdit/ui/surface'

export const mermaidSourceSelection = ViewPlugin.fromClass(class {
  private readonly owner: HTMLElement | null
  private active: { from: number; to: number } | null = null

  constructor(private readonly view: EditorView) {
    this.owner = view.dom.closest('.workspace-container')
  }

  update(update: ViewUpdate) {
    if (!this.owner || (!update.selectionSet && !update.docChanged && !update.focusChanged)) return

    const { doc, selection } = update.state
    if (!update.view.hasFocus || selection.ranges.length !== 1) {
      this.clear()
      return
    }

    let { from, to } = selection.main
    if (update.docChanged) {
      const active = this.active
      if (!active || !update.transactions.every(transaction =>
        transaction.isUserEvent('input.type') || transaction.isUserEvent('delete')
      )) {
        this.clear()
        return
      }

      let contained = true
      update.changes.iterChangedRanges((changeFrom, changeTo) => {
        contained &&= changeFrom >= active.from && changeTo <= active.to
      })
      from = update.changes.mapPos(active.from, -1)
      to = update.changes.mapPos(active.to, 1)
      if (!contained || selection.main.from < from || selection.main.to > to) {
        this.clear()
        return
      }
    }

    if (from === to || doc.lineAt(from).number !== doc.lineAt(to).number) {
      this.clear()
      return
    }

    this.active = { from, to }
    this.publish(from, to, update.docChanged)
  }

  destroy() {
    this.clear()
  }

  private clear() {
    if (!this.active) return
    this.active = null
    this.publish(0, 0, false)
  }

  private publish(from: number, to: number, typing: boolean) {
    if (!this.owner) return
    const detail: MermaidSourceSelection = {
      owner: this.owner,
      code: this.view.state.doc.toString(),
      from,
      to,
      typing,
    }
    this.view.dom.ownerDocument.defaultView?.dispatchEvent(
      new CustomEvent(MERMAID_SOURCE_SELECTION, { detail }),
    )
  }
})
