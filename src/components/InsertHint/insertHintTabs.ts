/**
 * The three diagram kinds the insert-hint banner offers, in rotation order.
 * Each names the slash command a person types in the Confluence editor.
 */
export type InsertHintTabId = 'flowchart' | 'architecture' | 'api';

export interface InsertHintTab {
  id: InsertHintTabId;
  title: string;
  description: string;
  command: string;
}

export const INSERT_HINT_TABS: readonly InsertHintTab[] = [
  { id: 'flowchart', title: 'Flowchart', description: 'Steps, decisions, loops', command: '/mermaid' },
  { id: 'architecture', title: 'Architecture', description: 'Systems and services', command: '/drawio' },
  { id: 'api', title: 'API docs', description: 'Endpoints from OpenAPI', command: '/swagger' },
];

/** Time each tab stays selected during the one automatic pass. */
export const ROTATE_STEP_MS = 3000;

/** How a tab became selected. */
export type InsertHintSwitchSource = 'auto' | 'click' | 'keyboard';

/**
 * Rotation plan: Flowchart, Architecture, API docs, then back to Flowchart and
 * stop. `step` counts automatic switches, starting at 1. Returns the index to
 * show at that step, or null once the pass is over (more switches than tabs).
 */
export function nextAutoIndex(index: number, step: number): number | null {
  if (step > INSERT_HINT_TABS.length) return null;
  return (index + 1) % INSERT_HINT_TABS.length;
}
