// Bounded reason for a FAILED AI Repair job, for `ai_repair_failed`.
//
// The Diagramly job carries the reason only as free text (`error`), and for a
// syntax rejection that text is the parser message, which echoes a line of the
// customer's diagram. So we classify the fixed server strings into an enum here
// and never send the text itself.
//
// Server strings come from diagramly.ai:
//   apps/web/app/api/chat/modify-async/worker.ts — message
//     "Could not produce a valid fix" (candidate rejected) vs
//     "Modification failed" (worker threw)
//   packages/core/ai/services/repair-validator.ts — empty / no-op gate reasons
//   packages/core/ai/domain-services/ai-diagram-domain-service.ts — prose reply,
//     time budget
//   apps/web/modules/saas/diagram/services/deterministic-syntax-parser.ts —
//     mermaid / zenuml / openapi parser messages
//   apps/web/modules/saas/diagram/services/plantuml-syntax-check.ts — PlantUML
// If the worker starts returning `output.failureCode`, that wins.

import type { RepairBackendFailureKind, RepairSyntaxErrorKind } from '@/utils/analytics/types';

export type { RepairBackendFailureKind, RepairSyntaxErrorKind };

export interface RepairFailureClassification {
  backend_failure_kind: RepairBackendFailureKind;
  backend_syntax_error_kind?: RepairSyntaxErrorKind;
}

interface FailedJobLike {
  status?: unknown;
  message?: unknown;
  error?: unknown;
  output?: { failureCode?: unknown; timedOut?: unknown } | null;
}

const FAILURE_CODES: Record<string, RepairBackendFailureKind> = {
  syntax_error: 'syntax_error',
  no_change: 'no_change',
  empty_output: 'empty_output',
};

const syntaxKind = (error: string): RepairSyntaxErrorKind => {
  if (/^Lexical error/i.test(error)) return 'lexical_error';
  if (/^No diagram type detected/i.test(error)) return 'no_diagram_type';
  if (/^Mermaid could not build the Gantt chart/i.test(error)) return 'gantt_build';
  if (/^(Parse error|Parsing failed)/i.test(error)) return 'parse_error';
  if (/^ZenUML could not parse|^line \d+:\d+ /.test(error)) return 'zenuml_parse';
  if (/^OpenAPI document /.test(error)) return 'openapi_structure';
  if (/^PlantUML syntax error/.test(error)) return 'plantuml_syntax';
  if (/^PlantUML code must (start|end) with/.test(error)) return 'plantuml_frame';
  return 'other';
};

export function classifyRepairFailure(job?: FailedJobLike | null): RepairFailureClassification {
  const error = typeof job?.error === 'string' ? job.error.trim() : '';
  const message = typeof job?.message === 'string' ? job.message : '';
  const code = job?.output?.failureCode;

  if (job?.status === 'COMPLETED') {
    return { backend_failure_kind: 'missing_output' };
  }
  if (job?.output?.timedOut === true || error === 'Repair time budget exhausted') {
    return { backend_failure_kind: 'time_budget' };
  }
  if (message === 'Modification failed') {
    return { backend_failure_kind: 'exception' };
  }
  if (typeof code === 'string' && FAILURE_CODES[code]) {
    const kind = FAILURE_CODES[code];
    return kind === 'syntax_error'
      ? { backend_failure_kind: kind, backend_syntax_error_kind: syntaxKind(error) }
      : { backend_failure_kind: kind };
  }
  if (!error) return { backend_failure_kind: 'unknown' };
  if (error.startsWith('No-op:')) return { backend_failure_kind: 'no_change' };
  if (error.startsWith('The repaired output was empty')) return { backend_failure_kind: 'empty_output' };
  if (error.startsWith('The reply held no diagram source')) return { backend_failure_kind: 'reply_not_diagram' };
  if (/^AI did not produce a valid fix after/.test(error)) return { backend_failure_kind: 'unknown' };
  if (message === 'Could not produce a valid fix') {
    return { backend_failure_kind: 'syntax_error', backend_syntax_error_kind: syntaxKind(error) };
  }
  return { backend_failure_kind: 'unknown' };
}
