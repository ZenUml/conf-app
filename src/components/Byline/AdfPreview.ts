import { defineComponent, h, type PropType, type VNode, type VNodeChild } from 'vue'

/**
 * One ADF block, drawn for the placement picker.
 *
 * A preview for finding your place, not a Confluence renderer: enough of the
 * page's words and shape that a reader recognises where they are. So text is
 * real, while images, macros and anything else that needs its own fetch or iframe
 * are labelled cards.
 *
 * Everything reaches the DOM through `h()` text children, never as HTML, because
 * this is user-authored page content. Links are not clickable for the same
 * reason nothing here is: the only action in this view is choosing a gap.
 *
 * Unknown node types must not break the page, so they fall through to a card.
 */

type AdfNode = {
  type?: string
  text?: string
  attrs?: Record<string, any>
  marks?: { type?: string }[]
  content?: AdfNode[]
}

const MAX_TABLE_ROWS = 6
const MAX_CODE_LINES = 8

const card = (label: string): VNode => h('div', { class: 'adf-card' }, label)

/** The plain words of a node, for labels and for what we flatten. */
export function adfText(node: unknown): string {
  const n = node as AdfNode | undefined
  if (!n || typeof n !== 'object') return ''
  if (n.type === 'text') return n.text ?? ''
  if (n.type === 'hardBreak') return ' '
  if (n.type === 'mention' || n.type === 'status') return String(n.attrs?.text ?? '')
  if (n.type === 'emoji') return String(n.attrs?.text ?? n.attrs?.shortName ?? '')
  if (n.type === 'inlineCard') return String(n.attrs?.url ?? '')
  const parts = (n.content ?? []).map(adfText)
  return parts.join(n.type === 'paragraph' || n.type === 'heading' ? '' : ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Our own macros carry no title in the ADF (only a customContentId and the
 * extension key), so without this every diagram on the page reads as "Macro".
 */
function isZenumlMacro(node: AdfNode | undefined): boolean {
  return String(node?.attrs?.extensionKey ?? '').includes('zenuml-')
}

function macroLabel(node: AdfNode): string {
  if (isZenumlMacro(node)) return 'Diagram'
  const title = node.attrs?.parameters?.extensionTitle ?? node.attrs?.extensionTitle
  return title ? `Macro: ${title}` : 'Macro'
}

/** What to call a block in "After …", and in the card when it has no words. */
export function blockLabel(node: unknown): string {
  const n = node as AdfNode | undefined
  const words = adfText(n)
  if (words && n?.type !== 'table' && n?.type !== 'codeBlock') {
    return `"${words.length > 48 ? `${words.slice(0, 48).trimEnd()}…` : words}"`
  }
  switch (n?.type) {
    case 'table':
      return 'the table'
    case 'codeBlock':
      return 'the code block'
    case 'mediaSingle':
    case 'mediaGroup':
      return 'the image'
    case 'extension':
    case 'bodiedExtension':
      return isZenumlMacro(n) ? 'the diagram' : 'the macro'
    case 'rule':
      return 'the divider'
    case 'paragraph':
      return 'the empty line'
    default:
      return 'that block'
  }
}

const MARK_TAGS: Record<string, string> = {
  strong: 'strong',
  em: 'em',
  code: 'code',
  strike: 's',
  underline: 'u',
  link: 'span',
}

function renderInline(node: AdfNode): VNodeChild {
  if (node.type === 'text') {
    // Innermost first, so the outer mark wraps it as the ADF lists them.
    return (node.marks ?? []).reduce<VNodeChild>((inner, mark) => {
      const tag = MARK_TAGS[mark?.type ?? '']
      if (!tag) return inner
      return h(tag, mark.type === 'link' ? { class: 'adf-link' } : null, [inner])
    }, node.text ?? '')
  }
  if (node.type === 'hardBreak') return h('br')
  if (node.type === 'status') return h('span', { class: 'adf-status' }, adfText(node))
  if (node.type === 'date') {
    const when = new Date(Number(node.attrs?.timestamp))
    return Number.isNaN(when.getTime()) ? '' : when.toISOString().slice(0, 10)
  }
  if (node.type === 'inlineExtension') return h('span', { class: 'adf-status' }, 'Macro')
  return adfText(node)
}

const inlines = (node: AdfNode): VNodeChild[] => (node.content ?? []).map(renderInline)
const blocks = (node: AdfNode): VNodeChild[] => (node.content ?? []).map(renderBlock)

function renderTable(node: AdfNode): VNode {
  const rows = node.content ?? []
  const shown = rows.slice(0, MAX_TABLE_ROWS).map(row =>
    h(
      'tr',
      (row.content ?? []).map(cell => h(cell.type === 'tableHeader' ? 'th' : 'td', adfText(cell))),
    ),
  )
  const hidden = rows.length - shown.length
  return h('div', { class: 'adf-table' }, [
    h('table', [h('tbody', shown)]),
    hidden > 0 ? h('div', { class: 'adf-more' }, `${hidden} more ${hidden === 1 ? 'row' : 'rows'}`) : null,
  ])
}

function renderCode(node: AdfNode): VNode {
  // Not adfText, which folds whitespace: here the line breaks are the content.
  const lines = (node.content ?? []).map(n => n.text ?? '').join('').split('\n')
  const shown = lines.slice(0, MAX_CODE_LINES).join('\n')
  const hidden = lines.length - MAX_CODE_LINES
  return h('pre', { class: 'adf-code' }, hidden > 0 ? `${shown}\n… ${hidden} more lines` : shown)
}

function renderBlock(node: AdfNode): VNodeChild {
  switch (node?.type) {
    case 'paragraph':
      return h('p', inlines(node))
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 2, 1), 6)
      return h(`h${level}`, inlines(node))
    }
    case 'bulletList':
      return h('ul', blocks(node))
    case 'orderedList':
      return h('ol', blocks(node))
    case 'listItem':
      return h('li', blocks(node))
    case 'taskList':
    case 'decisionList':
      return h('ul', { class: 'adf-tasks' }, blocks(node))
    case 'taskItem':
    case 'decisionItem':
      return h('li', inlines(node))
    case 'blockquote':
      return h('blockquote', blocks(node))
    case 'panel':
      return h('div', { class: 'adf-panel' }, blocks(node))
    case 'codeBlock':
      return renderCode(node)
    case 'rule':
      return h('hr')
    case 'table':
      return renderTable(node)
    case 'layoutSection':
      return h('div', { class: 'adf-layout' }, blocks(node))
    case 'layoutColumn':
      return h('div', { class: 'adf-column' }, blocks(node))
    case 'expand':
    case 'nestedExpand':
      return card(`Expand: ${node.attrs?.title || 'Untitled'}`)
    case 'mediaSingle':
    case 'mediaGroup':
      return card('Image or file')
    case 'extension':
    case 'bodiedExtension':
      return card(macroLabel(node))
    case 'blockCard':
    case 'embedCard':
      return card(String(node.attrs?.url ?? 'Link'))
    default:
      return card('Page content')
  }
}

export default defineComponent({
  name: 'AdfPreview',
  props: {
    // Deliberately unchecked: a page's content is data, and a malformed block
    // becomes a card rather than a warning.
    node: { type: null as unknown as PropType<unknown>, default: null },
  },
  setup(props) {
    return () => renderBlock(props.node as AdfNode)
  },
})
