/**
 * OpenAPI validation utilities
 */
import { SyntaxValidationResult } from '../validate/types';
import { extractErrorLineText, findMostRelevantLineNumber, replaceLineNumberInErrorMessage, createErrorLocation } from '../validate/common';

/**
 * Validates OpenAPI specification and returns detailed error information
 * @param spec The OpenAPI specification to validate (JSON or YAML)
 * @returns Promise<SyntaxValidationResult> with valid flag and error details if invalid
 */
export async function validateOpenApiSpec(spec: string): Promise<SyntaxValidationResult> {
  try {
    // Try to parse the spec as JSON first, then as YAML
    let parsedSpec;

    try {
      parsedSpec = JSON.parse(spec);
    } catch (jsonError) {
      // If JSON parsing fails, try to parse as YAML
      try {
        // Using js-yaml which is already in the project
        const yaml = await import('js-yaml');
        parsedSpec = yaml.load(spec);
      } catch (yamlError) {
        // Both JSON and YAML parsing failed
        throw new Error(`Invalid JSON/YAML syntax: ${(yamlError as Error).message}`);
      }
    }

    // Basic validation: check if it has required OpenAPI fields
    if (!parsedSpec.openapi && !parsedSpec.swagger) {
      throw new Error('Missing required field: openapi (for OpenAPI 3.x) or swagger (for Swagger 2.0)');
    }

    // For OpenAPI 3.x, check for required fields
    if (parsedSpec.openapi && parseFloat(parsedSpec.openapi) >= 3.0) {
      if (!parsedSpec.info) {
        throw new Error('Missing required field: info');
      }
      if (!parsedSpec.paths) {
        throw new Error('Missing required field: paths');
      }
    }

    // For Swagger 2.0, check for required fields
    if (parsedSpec.swagger && parseFloat(parsedSpec.swagger) === 2.0) {
      if (!parsedSpec.info) {
        throw new Error('Missing required field: info');
      }
      if (!parsedSpec.paths) {
        throw new Error('Missing required field: paths');
      }
    }

    return {
      valid: true,
      error: null,
      location: null
    };
  } catch (error: any) {
    const errorMessage = error?.message || String(error) || 'Unknown error';

    // Attempt to extract line and column information from the error
    let location = null;

    // Try to extract line number from error message
    const errorLineText = extractErrorLineText(errorMessage);
    const realLineNumber = findMostRelevantLineNumber(errorLineText, spec);

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

    console.error('OpenAPI spec validation error:', errorMessage, location);
    return {
      valid: false,
      error: location?.message || errorMessage,
      location
    };
  }
}

/**
 * Validates OpenAPI spec and updates Vuex store with error
 * @param spec - The OpenAPI specification to validate
 * @param store - The Vuex store instance
 * @param actionName - The name of the store action to dispatch (defaults to 'updateError')
 * @returns Promise<string | null> error message if validation fails, null otherwise
 */
export const validateOpenApiSpecForStore = async (
  spec: string,
  store?: any,
  actionName: string = 'updateError'
): Promise<string | null> => {
  const result = await validateOpenApiSpec(spec);

  if (store && actionName) {
    store.dispatch(actionName, result.error);
  }

  return result.error;
};