import { describe, it, expect, vi } from 'vitest';
import { configureDiagramFonts } from './configureDiagramFonts';

vi.mock('@zenuml/core/fonts/IBMPlexSans-Regular-Latin1.woff2?url', () => ({ default: '/assets/plex-abc.woff2' }));
vi.mock('@zenuml/core/fonts/MS-Sans-Serif.ttf?url', () => ({ default: '/assets/mssans-abc.ttf' }));

describe('configureDiagramFonts', () => {
  it('sets the Plex and MS Sans Serif URLs', () => {
    const setDiagramFontUrl = vi.fn();
    configureDiagramFonts({ setDiagramFontUrl });
    expect(setDiagramFontUrl).toHaveBeenCalledTimes(2);
    expect(setDiagramFontUrl).toHaveBeenNthCalledWith(1, '/assets/plex-abc.woff2');
    expect(setDiagramFontUrl).toHaveBeenNthCalledWith(2, '/assets/mssans-abc.ttf', 'MS Sans Serif');
  });
});
