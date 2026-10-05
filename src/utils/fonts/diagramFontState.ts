// Outcome of the hosted diagram-font load, reported on `macro_viewed` as
// `diagram_font`. Kept apart from the loader so analytics code can read it
// without importing the font asset.
export type DiagramFontValue = 'plex' | 'fallback';

let state: DiagramFontValue | undefined;

export function setDiagramFontState(value: DiagramFontValue): void {
  state = value;
}

/** Undefined until a render path has attempted the font load (non-sequence macros never do). */
export function getDiagramFontState(): DiagramFontValue | undefined {
  return state;
}

export function _resetDiagramFontStateForTesting(): void {
  state = undefined;
}
