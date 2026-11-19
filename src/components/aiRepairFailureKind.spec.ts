import { describe, it, expect } from 'vitest'
import { classifyRepairFailure } from './aiRepairFailureKind'

// Server strings come from diagramly.ai:
// apps/web/app/api/chat/modify-async/worker.ts (message + error),
// packages/core/ai/services/repair-validator.ts (gate reasons),
// packages/core/ai/domain-services/ai-diagram-domain-service.ts (loop reasons),
// apps/web/modules/saas/diagram/services/deterministic-syntax-parser.ts (parsers).
const invalid = (error: string, output: Record<string, unknown> = {}) => ({
  status: 'FAILED',
  message: 'Could not produce a valid fix',
  error,
  output: { repairAttempts: 1, timedOut: false, ...output },
})

describe('classifyRepairFailure', () => {
  it.each([
    ['No-op: the output is identical to the input, so nothing was fixed. You must actually change the diagram code to resolve the error.', 'no_change'],
    ['The repaired output was empty. Return the corrected diagram code.', 'empty_output'],
    ['The reply held no diagram source. Return the complete corrected diagram source, not an explanation.', 'reply_not_diagram'],
    ['Repair time budget exhausted', 'time_budget'],
    ['AI did not produce a valid fix after 1 attempt(s).', 'unknown'],
  ])('maps the gate reason %j to %s', (error, kind) => {
    expect(classifyRepairFailure(invalid(error))).toEqual({ backend_failure_kind: kind })
  })

  it.each([
    ['Parse error on line 3:\n...ment-->>Shop Payment confirmed\n----------------------^\nExpecting \'TXT\', got \'NEWLINE\'', 'parse_error'],
    ['Lexical error on line 2. Unrecognized text.\n...A --> B', 'lexical_error'],
    ['Parsing failed: unexpected character: -> <- at offset: 12', 'parse_error'],
    ['No diagram type detected matching given configuration for text: ```mermaid', 'no_diagram_type'],
    ['Mermaid could not build the Gantt chart: boom', 'gantt_build'],
    ['line 3:4 mismatched input \'}\' expecting ID', 'zenuml_parse'],
    ['ZenUML could not parse the diagram (syntax error).', 'zenuml_parse'],
    ['OpenAPI document is missing the required paths object.', 'openapi_structure'],
    ['Something the parser said', 'other'],
  ])('maps a syntax rejection %j to syntax_error / %s', (error, syntaxKind) => {
    expect(classifyRepairFailure(invalid(error))).toEqual({
      backend_failure_kind: 'syntax_error',
      backend_syntax_error_kind: syntaxKind,
    })
  })

  it('prefers the backend failureCode when the worker sends one', () => {
    expect(
      classifyRepairFailure(invalid('free text', { failureCode: 'no_change' })),
    ).toEqual({ backend_failure_kind: 'no_change' })
  })

  it('maps the worker exception branch to exception', () => {
    expect(
      classifyRepairFailure({
        status: 'FAILED',
        message: 'Modification failed',
        error: 'Insufficient credits',
        output: { repairAttempts: 0, timedOut: false },
      }),
    ).toEqual({ backend_failure_kind: 'exception' })
  })

  it('maps a server timeout to time_budget', () => {
    expect(
      classifyRepairFailure({
        status: 'FAILED',
        message: 'Modification failed',
        error: 'aborted',
        output: { repairAttempts: 0, timedOut: true },
      }),
    ).toEqual({ backend_failure_kind: 'time_budget' })
  })

  it('returns unknown for an unrecognised failed job', () => {
    expect(classifyRepairFailure({ status: 'FAILED' })).toEqual({ backend_failure_kind: 'unknown' })
  })

  it('never returns the server error text', () => {
    const secret = 'Parse error on line 1: customer-secret-line'
    const result = classifyRepairFailure(invalid(secret))
    expect(JSON.stringify(result)).not.toContain('customer-secret-line')
  })
})
