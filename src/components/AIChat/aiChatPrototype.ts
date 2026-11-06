import * as Diff from 'diff'

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
  versionId?: string
  previousVersionId?: string
  updatedCode?: string
}

export type AIChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  tone?: 'neutral' | 'error'
  preview?: AIChatChangePreview
}

export type AIChatVersion = {
  id: string
  versionNumber: number
  summary: string
  detail: string
  syntaxResolved: boolean
  time: string
  code?: string
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

export function createCodePreview(
  diagramTypeLabel: string,
  kind: AIChatChangeKind,
  previousCode: string,
  updatedCode: string,
): AIChatChangePreview {
  return {
    title: kind === 'syntax_repair' ? 'Syntax fixed' : 'Changes applied',
    kind,
    updatedCode,
    items: [
      kind === 'syntax_repair'
        ? 'Generated a syntax-safe update while preserving the existing diagram intent.'
        : 'Generated an updated diagram from your request.',
    ],
    diffLocation: `${diagramTypeLabel} diagram`,
    diffLines: buildDiffLines(previousCode, updatedCode),
  }
}

export function buildDiffLines(
  previousCode: string,
  updatedCode: string,
): AIChatDiffLine[] {
  const diff = Diff.diffLines(previousCode || '', updatedCode || '')
  const lines: AIChatDiffLine[] = []

  for (const part of diff) {
    const type: AIChatDiffLine['type'] = part.added
      ? 'add'
      : part.removed
        ? 'remove'
        : 'context'
    const partLines = part.value.replace(/\n$/, '').split('\n')
    for (const line of partLines) {
      if (line === '' && partLines.length === 1) continue
      lines.push({ type, code: line })
    }
  }

  return collapseDiffContext(lines)
}

function collapseDiffContext(lines: AIChatDiffLine[]): AIChatDiffLine[] {
  if (lines.length <= 80) return lines

  const interesting = new Set<number>()
  lines.forEach((line, index) => {
    if (line.type !== 'context') {
      for (let offset = -3; offset <= 3; offset += 1) {
        const target = index + offset
        if (target >= 0 && target < lines.length) interesting.add(target)
      }
    }
  })

  const indexes = Array.from(interesting).sort((a, b) => a - b)
  if (!indexes.length) {
    return [
      ...lines.slice(0, 79),
      { type: 'context', code: '...' },
    ]
  }

  const result: AIChatDiffLine[] = []
  let lastIndex = -1
  indexes.forEach((index) => {
    if (lastIndex < 0 && index > 0) {
      result.push({ type: 'context', code: '...' })
    } else if (lastIndex >= 0 && index > lastIndex + 1) {
      result.push({ type: 'context', code: '...' })
    }
    result.push(lines[index])
    lastIndex = index
  })
  if (lastIndex < lines.length - 1) {
    result.push({ type: 'context', code: '...' })
  }

  return result
}

export function formatVersionTime(date: Date | string = new Date()): string {
  const value = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(Number.isNaN(value.getTime()) ? new Date() : value)
}
