import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

import { MERMAID_SOURCE_SELECTION, type MermaidSourceSelection } from '@/features/mermaidInlineEdit/ui/surface'

export const mermaidSourceSelection = ViewPlugin.fromClass(class {
  private readonly owner: HTMLElement | null
  private active = false

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

    const { from, to } = selection.main
    const typing = update.docChanged && update.transactions.every(transaction =>
      !transaction.docChanged || transaction.isUserEvent('input.type') || transaction.isUserEvent('delete')
    )
    if ((update.docChanged && !typing) || doc.lineAt(from).number !== doc.lineAt(to).number) {
      this.clear()
      return
    }

    this.active = true
    this.publish({ owner: this.owner, code: doc.toString(), from, to, typing })
  }

  destroy() {
    this.clear()
  }

  private clear() {
    if (!this.owner || !this.active) return
    this.active = false
    this.publish({ owner: this.owner, clear: true })
  }

  private publish(detail: MermaidSourceSelection) {
    this.view.dom.ownerDocument.defaultView?.dispatchEvent(
      new CustomEvent(MERMAID_SOURCE_SELECTION, { detail }),
    )
  }
})
