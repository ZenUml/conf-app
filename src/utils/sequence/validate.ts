/**
 * Sequence diagram validation utilities
 */
import { SyntaxValidationResult } from '../validate/types';

const loadZenUml = () => import("@zenuml/core").then(module => module.default);

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
    // Dynamically import sequence parser to access the parse function
    const ZenUml = await loadZenUml();
    const zenuml = new ZenUml(document.createElement('div'));
    const result = await zenuml.parse(code);

    if (!result.pass && result.errorDetails && result.errorDetails.length > 0) {
      // Format the first error for display (we could format all errors if needed)
      const firstError = result.errorDetails[0];
      const errorMessage = `Sequence syntax error at line ${firstError.line}, column ${firstError.column}: ${firstError.msg}`;

      return {
        valid: false,
        error: errorMessage,
        location: {
          startLine: firstError.line,
          endLine: firstError.line,
          startCol: firstError.column,
          endCol: firstError.column + 10, // Default end column
          message: errorMessage
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