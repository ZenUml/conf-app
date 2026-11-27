// ZenUML syntax linter for the CodeMirror editor.
//
// Replaces `zenumlLinter` from @zenuml/codemirror-extensions. That one imports
// the full @zenuml/core statically and parses through `new ZenUml(div)`, so it
// put the whole 3.5 MB renderer into the static closure of every editor,
// including the Mermaid, PlantUML and Graph editors. This one lazy-loads the
// headless parser entry the first time it lints, the same entry
// `validateSequenceSyntax` uses. Diagnostic ranges match the package's: from
// the first error position to one past the last.
// vite.config.mjs marks the package's linter module side-effect free so the
// bundle drops it, and fails the build if the renderer reaches an editor again.
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { loadZenumlParser, type ZenumlParseResult } from '@/utils/sequence/parser';

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
    const firstOffset = offsetOf(lines, first.line - 1, first.column);
    const lastOffset = offsetOf(lines, last.line - 1, last.column);
    return [{
      from: Math.min(firstOffset, lastOffset),
      to: Math.min(Math.max(firstOffset, lastOffset) + 1, doc.length),
      severity: 'error',
      message: first.msg || 'Syntax error in zenuml diagram',
    }];
  }
  if (!result.pass) {
    return [{ from: 0, to: doc.length, severity: 'error', message: 'Syntax error in zenuml diagram' }];
  }
  return [];
}

export async function checkZenuml(view: EditorView): Promise<Diagnostic[]> {
  const doc = view.state.doc.toString();
  const { validate } = await loadZenumlParser();
  return zenumlDiagnostics(doc, validate(doc));
}

export const zenumlLinter = () => linter((view) => checkZenuml(view));
