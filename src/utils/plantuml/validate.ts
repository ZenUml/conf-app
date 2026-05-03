import { SyntaxValidationResult } from '../validate/types';
import { plantumlEncode } from './encode';

const PLANTUML_SERVER = 'https://www.plantuml.com/plantuml';

// Cache validation results to avoid duplicate API calls
const validationCache = new Map<string, { result: SyntaxValidationResult; timestamp: number }>();
const CACHE_TTL = 2000; // Cache for 2 seconds

/**
 * Validates PlantUML syntax using the official PlantUML server.
 * Sends code to https://www.plantuml.com/plantuml/svg/YOUR_ENCODED_CODE
 * and checks if the SVG contains syntax error indicators.
 * Results are cached for 2 seconds to avoid duplicate API calls.
 */
export async function validatePlantUmlSyntax(code: string): Promise<SyntaxValidationResult> {
  // Check cache first
  const cached = validationCache.get(code);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }
  if (!code || !code.trim()) {
    const result = { valid: true, error: null, location: null };
    validationCache.set(code, { result, timestamp: Date.now() });
    return result;
  }

  const trimmed = code.trim();

  // Basic structural checks first
  if (!trimmed.startsWith('@startuml')) {
    const result = {
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
    validationCache.set(code, { result, timestamp: Date.now() });
    return result;
  }

  if (!trimmed.endsWith('@enduml')) {
    const lines = trimmed.split('\n');
    const lastLine = lines.length;
    const result = {
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
    validationCache.set(code, { result, timestamp: Date.now() });
    return result;
  }

  // Validate using PlantUML server (SVG endpoint)
  // The SVG output contains error information in the rendered image
  try {
    const encoded = plantumlEncode(trimmed);
    const svgUrl = `${PLANTUML_SERVER}/svg/${encoded}`;
    
    const response = await fetch(svgUrl);
    
    // PlantUML returns 400 for syntax errors, but still includes SVG with error details
    // So we need to read the response body even for 400 status
    const svgText = await response.text();
    
    // Check if SVG contains syntax error indicators
    // PlantUML embeds error messages in the SVG when there are syntax errors
    if (svgText.includes('Syntax Error?')) {
      // Extract error message from SVG text content
      // Format: <text ...>Syntax Error? (message)</text>
      const errorMatch = svgText.match(/Syntax Error\?\s*\(([^)]+)\)/i);
      const errorMsg = errorMatch ? errorMatch[1] : 'Unknown syntax error';
      
      // Try to extract line number from error context
      // Format: [From string (line X) ] or [From textarea (line X) ]
      const lineMatch = svgText.match(/\[From (?:string|textarea) \(line (\d+)\)\s*\]/i);
      const lineNum = lineMatch ? parseInt(lineMatch[1], 10) : null;
      
      const errorResult = {
        valid: false,
        error: lineNum 
          ? `PlantUML syntax error at line ${lineNum}: ${errorMsg}`
          : `PlantUML syntax error: ${errorMsg}`,
        location: lineNum ? {
          startLine: lineNum,
          endLine: lineNum,
          startCol: 0,
          endCol: 0,
          message: errorMsg,
        } : null,
      };
      
      validationCache.set(code, { result: errorResult, timestamp: Date.now() });
      return errorResult;
    }
    
    // Check for HTTP errors (but only if no error info in SVG)
    if (!response.ok) {
      const errorResult = {
        valid: false,
        error: `PlantUML server error: HTTP ${response.status}`,
        location: null,
      };
      validationCache.set(code, { result: errorResult, timestamp: Date.now() });
      return errorResult;
    }
    
    // No error found, diagram is valid
    const validResult = { valid: true, error: null, location: null };
    validationCache.set(code, { result: validResult, timestamp: Date.now() });
    return validResult;
  } catch (error) {
    // If server validation fails, fall back to basic validation (already passed)
    console.warn('PlantUML server validation failed, falling back to basic checks:', error);
    const fallbackResult = { valid: true, error: null, location: null };
    validationCache.set(code, { result: fallbackResult, timestamp: Date.now() });
    return fallbackResult;
  }
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
