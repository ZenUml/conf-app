import { describe, it, expect, afterEach } from 'vitest';
import { detectDiagramFontState } from './diagramFontState';

const original = Object.getOwnPropertyDescriptor(document, 'fonts');
function stubFonts(faces: Array<{ family: string; status: string }>) {
  Object.defineProperty(document, 'fonts', { value: faces, configurable: true });
}

describe('detectDiagramFontState', () => {
  afterEach(() => {
    if (original) Object.defineProperty(document, 'fonts', original);
    else delete (document as unknown as { fonts?: unknown }).fonts;
  });

  it("is 'plex' when a loaded IBM Plex Sans face exists (quotes stripped)", () => {
    stubFonts([{ family: 'Other', status: 'loaded' }, { family: '"IBM Plex Sans"', status: 'loaded' }]);
    expect(detectDiagramFontState()).toBe('plex');
  });

  it("is 'fallback' when the face is not loaded or absent", () => {
    stubFonts([{ family: 'IBM Plex Sans', status: 'error' }]);
    expect(detectDiagramFontState()).toBe('fallback');
    stubFonts([]);
    expect(detectDiagramFontState()).toBe('fallback');
  });

  it("is 'fallback' when document.fonts is unavailable", () => {
    delete (document as unknown as { fonts?: unknown }).fonts;
    expect(detectDiagramFontState()).toBe('fallback');
  });
});
