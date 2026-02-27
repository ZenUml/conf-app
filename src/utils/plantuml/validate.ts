import { SyntaxValidationResult } from '../validate/types';

/**
 * Validates PlantUML syntax with basic structural checks.
 * Checks for @startuml/@enduml wrapper.
 */
export async function validatePlantUmlSyntax(code: string): Promise<SyntaxValidationResult> {
  if (!code || !code.trim()) {
    return { valid: true, error: null, location: null };
  }

  const trimmed = code.trim();

  if (!trimmed.startsWith('@startuml')) {
    return {
      valid: false,
      error: 'PlantUML code must start with @startuml',
      location: {
        startLine: 1,
        endLine: 1,
        startCol: 0,
        endCol: 10,
        message: 'PlantUML code must start with @startuml',
      },
    };
  }

  if (!trimmed.endsWith('@enduml')) {
    const lines = trimmed.split('\n');
    const lastLine = lines.length;
    return {
      valid: false,
      error: 'PlantUML code must end with @enduml',
      location: {
        startLine: lastLine,
        endLine: lastLine,
        startCol: 0,
        endCol: 10,
        message: 'PlantUML code must end with @enduml',
      },
    };
  }

  return { valid: true, error: null, location: null };
}

/**
 * Validates PlantUML syntax and updates Vuex store with error
 */
export const validatePlantUmlSyntaxForStore = async (
  code: string,
  store?: any,
  actionName: string = 'updateError'
): Promise<string | null> => {
  const result = await validatePlantUmlSyntax(code);

  if (store && actionName) {
    store.dispatch(actionName, result.error);
  }

  return result.error;
};
