export type AIChatChangeKind = 'request' | 'syntax_repair'

export type AIChatSuggestion = {
  id: string
  label: string
  description: string
}

export type AIChatDiffLine = {
  type: 'context' | 'add' | 'remove'
  code: string
}

export type AIChatChangePreview = {
  title: string
  items: string[]
  diffLocation: string
  diffLines: AIChatDiffLine[]
  kind?: AIChatChangeKind | 'undo' | 'rollback'
  versionId?: number
  previousVersionId?: number
}

export type AIChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  preview?: AIChatChangePreview
}

export type AIChatVersion = {
  id: number
  summary: string
  detail: string
  syntaxResolved: boolean
  time: string
}

export const AI_CHAT_SUGGESTIONS: AIChatSuggestion[] = [
  {
    id: 'add-error-path',
    label: 'Add an error handling path',
    description: 'Include failure, retry, or timeout behavior.',
  },
  {
    id: 'simplify-flow',
    label: 'Simplify the main flow',
    description: 'Reduce noise and make the happy path easier to scan.',
  },
  {
    id: 'highlight-steps',
    label: 'Highlight the key steps',
    description: 'Emphasize the most important interactions.',
  },
]

export function createPrototypePreview(
  diagramTypeLabel: string,
  kind: AIChatChangeKind,
  syntaxResolved: boolean,
): AIChatChangePreview {
  if (diagramTypeLabel === 'OpenAPI') {
    if (kind === 'syntax_repair') {
      return {
        title: 'Syntax fixed',
        kind,
        items: ['Corrected the invalid response block and preserved the existing operations.'],
        diffLocation: 'openapi.yaml · response definition',
        diffLines: [
          { type: 'remove', code: '    400:' },
          { type: 'add', code: '    "400":' },
          { type: 'add', code: '      description: Invalid request' },
        ],
      }
    }

    return {
      title: 'Changes applied',
      kind,
      items: ['Added a documented failure response while preserving the current API structure.'],
      diffLocation: 'openapi.yaml · responses',
      diffLines: [
        { type: 'context', code: 'responses:' },
        { type: 'add', code: '  "400":' },
        { type: 'add', code: '    description: Invalid request' },
        { type: 'add', code: '  "504":' },
        { type: 'add', code: '    description: Upstream timeout' },
      ],
    }
  }

  if (kind === 'syntax_repair') {
    return {
      title: 'Syntax fixed',
      kind,
      items: ['Added the missing target to the invalid message and kept the rest of the flow unchanged.'],
      diffLocation: 'diagram.zenuml · syntax issue',
      diffLines: [
        { type: 'remove', code: 'Payment -> "payment failed"' },
        { type: 'add', code: 'Payment -> Checkout: "payment failed"' },
      ],
    }
  }

  return {
    title: 'Changes applied',
    kind,
    items: ['Added failure and timeout paths while preserving the existing success flow.'],
    diffLocation: 'diagram.zenuml · error path',
    diffLines: [
      { type: 'context', code: 'Payment.charge()' },
      ...(!syntaxResolved
        ? [{ type: 'remove' as const, code: 'Payment -> "payment failed"' }]
        : []),
      { type: 'add', code: 'Payment -> Checkout: "payment failed"' },
      { type: 'add', code: 'Payment -> Checkout: "payment timeout"' },
    ],
  }
}

export function formatVersionTime(date = new Date()): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
