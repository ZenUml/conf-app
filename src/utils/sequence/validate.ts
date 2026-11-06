/**
 * Sequence diagram validation utilities
 */
import { SyntaxValidationResult } from '../validate/types';

interface ZenumlErrorDetail {
  line: number;
  column: number;
  msg: string;
}

interface ZenumlParseResult {
  pass: boolean;
  errorDetails: ZenumlErrorDetail[];
}

// Headless, reentrant parser entry. `new ZenUml(el).parse()` mounts a React
// root and appends a headlessui portal root to document.body on every call,
// and neither is ever torn down.
const loadZenumlParser = () =>
  // @ts-expect-error -- root tsconfig `moduleResolution: "node"` cannot see `exports` subpaths
  import('@zenuml/core/parser') as Promise<{ validate(code: string): ZenumlParseResult }>;

/**
 * Function to validate sequence syntax and return validation result
 * @param code - The sequence diagram code to validate
 * @returns Promise<SyntaxValidationResult> with validation outcome
 */
export const validateSequenceSyntax = async (code: string): Promise<SyntaxValidationResult> => {
  if (!code) {
    return {
      valid: true,
      error: null,
      location: null
    };
  }

  try {
    const { validate } = await loadZenumlParser();
    const result = validate(code);

    if (!result.pass && result.errorDetails && result.errorDetails.length > 0) {
      // 1. Get all error messages and merge them
      const errorMessages = result.errorDetails.map((err) => 
        `at line ${err.line}, column ${err.column}: ${err.msg}`
      );
      const combinedErrorMessage = `Sequence syntax error: ${errorMessages.join('\n')}`;

      // 2. Get the first and last error
      const firstError = result.errorDetails[0];
      const lastError = result.errorDetails[result.errorDetails.length - 1];

      return {
        valid: false,
        error: combinedErrorMessage,
        location: {
          // Use firstError as the starting point
          startLine: firstError.line,
          startCol: firstError.column,
          // Use lastError as the ending point
          endLine: lastError.line,
          endCol: lastError.column + 10, // Extend 10 characters backward as highlight range by default
          message: combinedErrorMessage
        }
      };
    } else {
      return {
        valid: true,
        error: null,
        location: null
      }; // No errors
    }
  } catch (error) {
    const errorMessage = `Sequence parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return {
      valid: false,
      error: errorMessage,
      location: null
    };
  }
};

/**
 * Validates sequence syntax and updates Vuex store with error
 * @param code - The sequence diagram code to validate
 * @param store - The Vuex store instance
 * @param actionName - The name of the store action to dispatch (defaults to 'updateError')
 * @returns Promise<string | null> error message if validation fails, null otherwise
 */
export const validateSequenceSyntaxForStore = async (
  code: string,
  store?: any,
  actionName: string = 'updateError'
): Promise<string | null> => {
  const result = await validateSequenceSyntax(code);

  if (store && actionName) {
    store.dispatch(actionName, result.error);
  }

  return result.error;
};