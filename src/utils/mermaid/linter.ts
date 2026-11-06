import { linter, Diagnostic } from '@codemirror/lint';
import { validateMermaidSyntax } from "@/utils/mermaid/validate";
import { findIgnoredInitDirective } from "@/utils/mermaid/initDirective";
import { convertLineColToPosition } from "@/utils/validate/common";

// Create a linter for Mermaid diagrams
export const mermaidLinter = linter(async (view) => {
  const doc = view.state.doc.toString();
  if (!doc.trim()) return [];

  // A malformed `%%{init: …}%%` is the one failure mermaid never reports:
  // `mermaid.parse` succeeds, the diagram renders with defaults, and the author
  // is told nothing. Surface it as a warning — the diagram does render, so an
  // error would wrongly claim it is broken. See initDirective.ts.
  const ignoredInit = findIgnoredInitDirective(doc);
  const initDiagnostics: Diagnostic[] = ignoredInit
    ? [{
        from: ignoredInit.from,
        to: ignoredInit.to,
        severity: "warning" as const,
        message:
          'This init directive is not valid JSON, so mermaid ignores it and renders the ' +
          'diagram with default settings. Nothing else will report this. Check for a missing ' +
          `value, an unquoted key or a trailing comma in: ${ignoredInit.raw}`,
      }]
    : [];

  // Direct call for immediate validation (Codemirror handles the frequency of linter calls)
  const result = await validateMermaidSyntax(doc);
  if (!result.valid && result.error) {
    if (result.location) {
      const { startLine, endLine, startCol, endCol } = result.location;
      const from = convertLineColToPosition(doc, startLine, startCol);
      const to = convertLineColToPosition(doc, endLine, endCol);

      return [
        ...initDiagnostics,
        {
          from,
          to,
          message: `Mermaid syntax error: ${result.error}`,
          severity: "error" as const,
        }
      ];
    } else {
      // Fallback to highlighting first 50 characters if no location info
      return [
        ...initDiagnostics,
        {
          from: 0,
          to: Math.min(50, doc.length), // Highlight first 50 characters or less
          message: `Mermaid syntax error: ${result.error}`,
          severity: "error" as const,
        }
      ];
    }
  }
  return initDiagnostics;
});
