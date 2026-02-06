/**
 * Common validation utilities
 */
import { ErrorLocation } from './types';

/**
 * Helper function to convert line/column to character position
 */
export function convertLineColToPosition(doc: string, line: number, col: number): number {

  const lines = doc.split('\n');

  // Lines are 1-indexed, so subtract 1 to get 0-indexed position
  const targetLineIndex = line - 1;

  // Ensure we're within bounds
  if (targetLineIndex < 0 || targetLineIndex >= lines.length) {
    return 0; // Return start of document if line is out of bounds
  }

  // Calculate position by adding lengths of lines before target line
  // plus the column position (adjusting for 0-indexed columns)
  let position = 0;
  for (let i = 0; i < targetLineIndex; i++) {
    position += lines[i].length + 1; // +1 for the newline character
  }

  // Add the column position
  position += Math.max(0, col - 1); // Col 1 = index 0, so subtract 1

  // Ensure position is not beyond the document length
  return Math.min(position, doc.length);
}

/**
 * Common error handling utilities for validation
 */

/**
 * Function to find the line number with the most characters in common with the error
 */
export function findMostRelevantLineNumber(errorLineText: string, code: string): number {
  const codeLines = code.split('\n');
  let mostRelevantLineNumber = -1;
  let maxOverlap = 0;

  // Trim whitespace from error text to improve matching
  const trimmedError = errorLineText.trim();

  for (let i = 0; i < codeLines.length; i++) {
    const line = codeLines[i].trim();
    if (!line) continue; // Skip empty lines

    const overlap = calculateStringOverlap(trimmedError, line);
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      mostRelevantLineNumber = i + 1; // Line numbers start from 1
    }
  }
  return mostRelevantLineNumber;
}

/**
 * Calculates the overlap between two strings (longest common substring)
 */
function calculateStringOverlap(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;

  let maxOverlap = 0;

  // Check all possible starting positions in str1
  for (let i = 0; i < str1.length; i++) {
    for (let j = 0; j < str2.length; j++) {
      let k = 0;
      // Count matching characters from current positions
      while (
        i + k < str1.length &&
        j + k < str2.length &&
        str1[i + k] === str2[j + k]
      ) {
        k++;
      }
      maxOverlap = Math.max(maxOverlap, k);
    }
  }

  return maxOverlap;
}

/**
 * Function to replace the incorrect line number in the error message
 */
export function replaceLineNumberInErrorMessage(
  errorMessage: string,
  realLineNumber: number
): string {
  // Match both "Parse error" and "Lexical error" patterns
  const lineErrorRegex = /(Parse|Lexical) error on line \d+/g;
  return errorMessage.replace(lineErrorRegex, `$1 error on line ${realLineNumber}`);
}

export function extractErrorLineText(errorMessage: string): string {
  // Look for parse error line
  const parseMatch = errorMessage.match(/Error: Parse error on line \d+:\n(.+)\n+/);
  if (parseMatch) {
    return parseMatch[1].slice(3);
  }

  // Look for lexical error line
  const lexMatch = errorMessage.match(/Error: Lexical error on line \d+. Unrecognized text.\n(.+)\n-+/);
  if (lexMatch) {
    return lexMatch[1].slice(3);
  }

  // If no error line found, return empty string
  return '';
}

/**
 * Creates a standardized error location object
 */
export function createErrorLocation(
  startLine: number,
  endLine: number,
  startCol: number,
  endCol: number,
  message: string
): ErrorLocation {
  return {
    startLine,
    endLine,
    startCol,
    endCol,
    message
  };
}