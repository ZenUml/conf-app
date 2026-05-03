import { linter } from '@codemirror/lint';
import { validatePlantUmlSyntax } from "@/utils/plantuml/validate";
import { convertLineColToPosition } from "@/utils/validate/common";

// Create a linter for PlantUML diagrams
export const plantumlLinter = linter(async (view) => {
  const doc = view.state.doc.toString();
  if (!doc.trim()) return [];

  // Direct call for immediate validation (Codemirror handles the frequency of linter calls)
  const result = await validatePlantUmlSyntax(doc);
  if (!result.valid && result.error) {
    if (result.location) {
      const { startLine, endLine, startCol, endCol } = result.location;
      const from = convertLineColToPosition(doc, startLine, startCol);
      let to = convertLineColToPosition(doc, endLine, endCol);
      
      // If endCol is 0 or from === to, highlight the entire line
      if (to <= from) {
        const lines = doc.split('\n');
        const lineIndex = startLine - 1;
        if (lineIndex >= 0 && lineIndex < lines.length) {
          // Calculate start of line
          let lineStart = 0;
          for (let i = 0; i < lineIndex; i++) {
            lineStart += lines[i].length + 1;
          }
          // Highlight entire line
          to = lineStart + lines[lineIndex].length;
          // Ensure from is at start of line
          const actualFrom = lineStart;
          
          return [
            {
              from: actualFrom,
              to: Math.max(to, actualFrom + 1), // Ensure at least 1 character
              message: result.error,
              severity: "error" as const,
            }
          ];
        }
      }

      return [
        {
          from,
          to: Math.max(to, from + 1), // Ensure at least 1 character is highlighted
          message: result.error,
          severity: "error" as const,
        }
      ];
    } else {
      // Fallback to highlighting first 50 characters if no location info
      return [
        {
          from: 0,
          to: Math.min(50, doc.length), // Highlight first 50 characters or less
          message: result.error,
          severity: "error" as const,
        }
      ];
    }
  }
  return [];
});
