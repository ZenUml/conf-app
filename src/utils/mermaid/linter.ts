import { linter } from '@codemirror/lint';
import { validateMermaidSyntax } from "@/utils/mermaid/validate";
import { convertLineColToPosition } from "@/utils/validate/common";

// Create a linter for Mermaid diagrams
export const mermaidLinter = linter(async (view) => {
  const doc = view.state.doc.toString();
  if (!doc.trim()) return [];

  // Direct call for immediate validation (Codemirror handles the frequency of linter calls)
  const result = await validateMermaidSyntax(doc);
  if (!result.valid && result.error) {
    if (result.location) {
      const { startLine, endLine, startCol, endCol } = result.location;
      const from = convertLineColToPosition(doc, startLine, startCol);
      const to = convertLineColToPosition(doc, endLine, endCol);

      return [
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
        {
          from: 0,
          to: Math.min(50, doc.length), // Highlight first 50 characters or less
          message: `Mermaid syntax error: ${result.error}`,
          severity: "error" as const,
        }
      ];
    }
  }
  return [];
});