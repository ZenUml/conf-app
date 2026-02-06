/**
 * Common validation types and interfaces
 */

/**
 * Interface for error location information
 */
export interface ErrorLocation {
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
  message: string;
}

/**
 * Base validation result interface
 */
export interface SyntaxValidationResult<T = null> {
  valid: boolean;
  error: string | null;
  location?: ErrorLocation | null;
  details?: T;
}

/**
 * Position conversion parameters
 */
export interface PositionParams {
  line: number;
  col: number;
}