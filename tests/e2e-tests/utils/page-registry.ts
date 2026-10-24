import fs from 'fs';
import path from 'path';

import type { RenderMacroType } from '../config/apps.js';

/**
 * Re-exported under the local name for the existing callers. The union itself
 * now lives in config/apps.ts: this file used to hardcode its own copy of the
 * five, and when `MacroType` gained 'asyncapi' the two silently diverged —
 * `fixtures/macro-test.ts` aliases MacroType and passes it to getPageId(), so
 * the copies had to stay identical and nothing enforced it.
 */
export type DiagramType = RenderMacroType;

interface TestPages {
  sequence?: string;
  graph?: string;
  openapi?: string;
  embed?: string;
  mermaid?: string;
}

const TEST_PAGES_FILE = path.join(__dirname, '..', 'test-pages.json');

/**
 * Get the page ID for a specific diagram type
 * @param diagramType The type of diagram
 * @returns The page ID
 * @throws Error if page ID is not found
 */
export function getPageId(diagramType: DiagramType): string {
  if (!fs.existsSync(TEST_PAGES_FILE)) {
    throw new Error(`Test pages file not found: ${TEST_PAGES_FILE}. Did the pages setup run?`);
  }

  const pages: TestPages = JSON.parse(fs.readFileSync(TEST_PAGES_FILE, 'utf-8'));
  const pageId = pages[diagramType];

  if (!pageId) {
    throw new Error(`Page ID not found for diagram type: ${diagramType}`);
  }

  return pageId;
}

/**
 * Get all test page IDs
 * @returns Object with all page IDs
 */
export function getAllPageIds(): TestPages {
  if (!fs.existsSync(TEST_PAGES_FILE)) {
    throw new Error(`Test pages file not found: ${TEST_PAGES_FILE}. Did the pages setup run?`);
  }

  return JSON.parse(fs.readFileSync(TEST_PAGES_FILE, 'utf-8'));
}
