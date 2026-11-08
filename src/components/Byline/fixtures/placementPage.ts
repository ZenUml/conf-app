/** A synthetic page covering the node types the placement picker draws. */
const text = (value: string, marks?: { type: string }[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const para = (...content: unknown[]) => ({ type: 'paragraph', content })
const cell = (type: string, value: string) => ({ type, content: [para(text(value))] })

export const PLACEMENT_PAGE_CONTENT: unknown[] = [
  { type: 'heading', attrs: { level: 2 }, content: [text('Overview')] },
  para(
    text('The payment service '),
    text('authorises', [{ type: 'strong' }]),
    text(' cards, captures funds, and reports settlement back to '),
    text('orders', [{ type: 'code' }]),
    text('.'),
  ),
  {
    type: 'table',
    content: [
      { type: 'tableRow', content: [cell('tableHeader', 'Endpoint'), cell('tableHeader', 'Owner'), cell('tableHeader', 'SLA')] },
      { type: 'tableRow', content: [cell('tableCell', '/authorise'), cell('tableCell', 'Payments'), cell('tableCell', '200 ms')] },
      { type: 'tableRow', content: [cell('tableCell', '/capture'), cell('tableCell', 'Payments'), cell('tableCell', '500 ms')] },
    ],
  },
  { type: 'heading', attrs: { level: 2 }, content: [text('Failure handling')] },
  {
    type: 'bulletList',
    content: [
      { type: 'listItem', content: [para(text('Retry card networks twice'))] },
      { type: 'listItem', content: [para(text('Then fail the order and alert'))] },
    ],
  },
  {
    type: 'extension',
    attrs: { extensionType: 'com.atlassian.ecosystem', parameters: { extensionTitle: 'Sequence diagram' } },
  },
  { type: 'panel', attrs: { panelType: 'info' }, content: [para(text('Settlement runs nightly.'))] },
  {
    type: 'layoutSection',
    content: [
      { type: 'layoutColumn', attrs: { width: 50 }, content: [para(text('Left column'))] },
      { type: 'layoutColumn', attrs: { width: 50 }, content: [para(text('Right column'))] },
    ],
  },
  { type: 'codeBlock', attrs: { language: 'json' }, content: [text('{\n  "status": "captured"\n}')] },
  { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'img-1', type: 'file' } }] },
]
