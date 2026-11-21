// ZenUML syntax linter for the CodeMirror editor.
//
// Replaces `zenumlLinter` from @zenuml/codemirror-extensions. That one imports
// the full @zenuml/core statically and parses through `new ZenUml(div)`, so it
// put the whole 3.5 MB renderer into the static closure of every editor,
// including the Mermaid, PlantUML and Graph editors. This one lazy-loads the
// headless `@zenuml/core/parser` entry (~280 KB) the first time it lints, the
// same entry `validateSequenceSyntax` uses. Diagnostic ranges match the
// package's: from the first error position to one past the last.
// vite.config.mjs marks the package's linter module side-effect free so the
// bundle drops it.
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';

interface ZenumlParseResult {
  pass: boolean;
  errorDetails?: { line: number; column: number; msg: string }[];
}

type Validate = (code: string) => ZenumlParseResult;

const loadValidate = (): Promise<Validate> =>
  // @ts-expect-error -- root tsconfig `moduleResolution: "node"` cannot see `exports` subpaths
  (import('@zenuml/core/parser') as Promise<{ validate: Validate }>).then((m) => m.validate);

function offsetOf(lines: string[], line: number, column: number): number {
  if (line < 0 || line >= lines.length) return 0;
  let offset = 0;
  for (let i = 0; i < line; i++) offset += lines[i].length + 1;
  return offset + column;
}

export function zenumlDiagnostics(doc: string, result: ZenumlParseResult | undefined): Diagnostic[] {
  if (!result) return [];
  const details = Array.isArray(result.errorDetails) ? result.errorDetails : [];
  if (details.length > 0) {
    const first = details[0];
    const last = details[details.length - 1];
    const lines = doc.split('\n');
    const a = offsetOf(lines, first.line - 1, first.column);
    const b = offsetOf(lines, last.line - 1, last.column);
    return [{
      from: Math.min(a, b),
      to: Math.min(Math.max(a, b) + 1, doc.length),
      severity: 'error',
      message: first.msg || 'Syntax error in zenuml diagram',
    }];
  }
  if (!result.pass) {
    return [{ from: 0, to: doc.length, severity: 'error', message: 'Syntax error in zenuml diagram' }];
  }
  return [];
}

export async function checkZenuml(view: EditorView, load: () => Promise<Validate> = loadValidate): Promise<Diagnostic[]> {
  const doc = view.state.doc.toString();
  const validate = await load();
  return zenumlDiagnostics(doc, validate(doc));
}

export const zenumlLinter = () => linter((view) => checkZenuml(view));
