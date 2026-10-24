// Outcome of the hosted diagram-font load, reported on `macro_viewed` as
// `diagram_font`. Kept apart from core so analytics code can read it without
// importing the renderer.
export type DiagramFontValue = 'plex' | 'fallback';

let state: DiagramFontValue | undefined;

export function setDiagramFontState(value: DiagramFontValue): void {
  state = value;
}

/** Undefined until a sequence render has finished (non-sequence macros never set it). */
export function getDiagramFontState(): DiagramFontValue | undefined {
  return state;
}

/** Core registers the face on document.fonts; 'plex' means it is there and loaded. */
export function detectDiagramFontState(): DiagramFontValue {
  try {
    for (const face of document.fonts as unknown as Iterable<FontFace>) {
      if (face.family.replace(/["']/g, '') === 'IBM Plex Sans' && face.status === 'loaded') return 'plex';
    }
  } catch {
    // document.fonts missing (jsdom/SSR) or not iterable
  }
  return 'fallback';
}

export function _resetDiagramFontStateForTesting(): void {
  state = undefined;
}
