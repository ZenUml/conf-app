/**
 * Mermaid validation utilities
 */
import { loadMermaid } from './loadMermaid';
import { SyntaxValidationResult } from '../validate/types';
import { extractErrorLineText, findMostRelevantLineNumber, replaceLineNumberInErrorMessage, createErrorLocation } from '../validate/common';

/**
 * Validates Mermaid syntax and returns detailed error information
 * @param code The Mermaid code to validate
 * @returns Promise<SyntaxValidationResult> with valid flag and error details if invalid
 */
export async function validateMermaidSyntax(code: string): Promise<SyntaxValidationResult> {
  try {
    const mermaid = await loadMermaid();
    // Re-initialize for validation (looser settings than the renderer's defaults)
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      logLevel: 0,
    });

    // Attempt to parse the code
    await mermaid.parse(code);
    return {
      valid: true,
      error: null,
      location: null
    };
  } catch (error: any) {
    const errorMessage = error?.message || String(error) || 'Unknown error';

    // Attempt to extract line and column information from the error
    let location = null;

    // If the error has location information (like the hash.loc in the reference)
    if (error?.hash?.loc) {
      const { first_line, last_line, first_column, last_column } = error.hash.loc;
      const errorLineText = extractErrorLineText(errorMessage);
      const realLineNumber = findMostRelevantLineNumber(errorLineText, code);

      location = createErrorLocation(
        realLineNumber !== -1 ? realLineNumber : first_line,
        realLineNumber !== -1 ? realLineNumber + 1 : last_line,
        first_column,
        last_column + (first_column === last_column ? 0 : 5), // Adjust end column similar to reference
        replaceLineNumberInErrorMessage(errorMessage, realLineNumber !== -1 ? realLineNumber : first_line)
      );
    } else {
      // Fallback: try to extract line number from error message
      const errorLineText = extractErrorLineText(errorMessage);
      const realLineNumber = findMostRelevantLineNumber(errorLineText, code);

      if (realLineNumber !== -1) {
        const replacedMessage = replaceLineNumberInErrorMessage(errorMessage, realLineNumber);
        location = createErrorLocation(
          realLineNumber,
          realLineNumber,
          0,
          10, // Default end column for rough highlighting
          replacedMessage
        );
      } else {
        // Try to extract from error message with regex
        const lineMatch = errorMessage.match(/line (\d+)/i);
        if (lineMatch) {
          const lineNo = parseInt(lineMatch[1], 10);
          location = createErrorLocation(
            lineNo,
            lineNo,
            0,
            10,
            errorMessage
          );
        }
      }
    }

    console.error('Mermaid syntax validation error:', errorMessage, location);
    return {
      valid: false,
      error: location?.message || errorMessage,
      location
    };
  }
}

/**
 * Validates mermaid syntax and updates Vuex store with error
 * @param code - The mermaid diagram code to validate
 * @param store - The Vuex store instance
 * @param actionName - The name of the store action to dispatch (defaults to 'updateError')
 * @returns Promise<string | null> error message if validation fails, null otherwise
 */
export const validateMermaidSyntaxForStore = async (
  code: string,
  store?: any,
  actionName: string = 'updateError'
): Promise<string | null> => {
  const result = await validateMermaidSyntax(code);

  if (store && actionName) {
    store.dispatch(actionName, result.error);
  }

  return result.error;
};