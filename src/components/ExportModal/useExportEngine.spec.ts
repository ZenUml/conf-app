import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/model/captureBlob', () => ({ captureBlob: vi.fn(), default: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

import { captureBlob } from '@/model/captureBlob';
import { saveAs } from 'file-saver';
import {
  useExportEngine,
  slugifyFilename,
  isClipboardExportSupported,
  buildOverlaySvg,
  fitWatermark,
  measureTextWidth,
  type ExportOptions,
} from './useExportEngine';
import { MONO_FONT_FAMILY } from './overlayGeometry';
import type { Annotation } from './useAnnotations';

function baseOptions(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    background: 'white',
    note: { text: '', position: 'bottom-center', fontSize: 14, color: '#374151' },
    arrow: { type: '→', label: '', color: '#ef4444', thickness: 2 },
    watermark: null,
    callout: null,
    arrowPoints: null,
    notePoint: null,
    ...overrides,
  };
}

describe('fitWatermark', () => {
  // A shallow, wide diagram — the shape that clipped "Internal review -
  // Confidential" at both ends while the shorter default happened to fit.
  const W = 840;
  const H = 274;
  const PADDING = 16;
  const fits = (text: string, fontSize: number, diagonal = true) => {
    const available = diagonal
      ? Math.SQRT2 * (Math.min(W, H) - 2 * PADDING) - fontSize * 1.2
      : W - 2 * PADDING;
    return measureTextWidth(text, fontSize, MONO_FONT_FAMILY) <= available + 0.5;
  };

  it('leaves a watermark that already fits alone', () => {
    const result = fitWatermark('Confidential', 24, true, W, H, PADDING);
    expect(result).toEqual({ fontSize: 24, fitAttributes: '' });
  });

  it('shrinks a long diagonal watermark until it fits the rotated bounds', () => {
    const result = fitWatermark('Internal review - Confidential', 24, true, W, H, PADDING);
    expect(result.fontSize).toBeLessThan(24);
    expect(result.fontSize).toBeGreaterThanOrEqual(8);
    expect(fits('Internal review - Confidential', result.fontSize)).toBe(true);
  });

  it('compresses glyphs rather than clipping when the floor is reached', () => {
    const result = fitWatermark('x'.repeat(400), 24, true, W, H, PADDING);
    expect(result.fontSize).toBe(8);
    expect(result.fitAttributes).toMatch(/textLength="[\d.]+" lengthAdjust="spacingAndGlyphs"/);
  });

  it('fits a bottom-right watermark to the width it is anchored in', () => {
    const result = fitWatermark('Internal review - Confidential', 48, false, 300, 200, PADDING);
    expect(result.fontSize).toBeLessThan(48);
    expect(measureTextWidth('Internal review - Confidential', result.fontSize, MONO_FONT_FAMILY))
      .toBeLessThanOrEqual(300 - 2 * PADDING + 0.5);
  });

  it('is what buildOverlaySvg stamps with', () => {
    const svg = buildOverlaySvg(W, H, baseOptions({
      watermark: { text: 'Internal review - Confidential', opacity: 20, fontSize: 24, color: '#9ca3af', position: 'diagonal' },
    }));
    const fontSize = Number(svg.match(/font-size="([\d.]+)"[^>]*transform="rotate\(-45/)?.[1]);
    expect(fontSize).toBeLessThan(24);
  });
});

describe('slugifyFilename', () => {
  it('lowercases, replaces unsafe/space runs with a single hyphen, and appends .png', () => {
    expect(slugifyFilename('Login Flow (v2)')).toBe('login-flow-v2.png');
  });

  it('trims leading/trailing hyphens produced by leading/trailing unsafe chars', () => {
    expect(slugifyFilename('  --Checkout!!--  ')).toBe('checkout.png');
  });

  it('falls back to zenuml-diagram-export.png for an empty title', () => {
    expect(slugifyFilename('')).toBe('zenuml-diagram-export.png');
  });

  it('falls back to zenuml-diagram-export.png when the title has no safe characters', () => {
    expect(slugifyFilename('!!!###')).toBe('zenuml-diagram-export.png');
  });

  it('caps the slug at ~60 characters and does not leave a trailing hyphen', () => {
    const longTitle = 'a'.repeat(40) + ' ' + 'b'.repeat(40);
    const result = slugifyFilename(longTitle);
    expect(result.endsWith('.png')).toBe(true);
    expect(result.slice(0, -4).length).toBeLessThanOrEqual(60);
    expect(result.slice(0, -4).endsWith('-')).toBe(false);
  });
});

describe('isClipboardExportSupported', () => {
  const originalClipboardItem = (globalThis as any).ClipboardItem;
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    (globalThis as any).ClipboardItem = originalClipboardItem;
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  });

  it('is true when both ClipboardItem and navigator.clipboard.write exist', () => {
    (globalThis as any).ClipboardItem = class {};
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn() }, configurable: true });
    expect(isClipboardExportSupported()).toBe(true);
  });

  it('is false when ClipboardItem is missing', () => {
    delete (globalThis as any).ClipboardItem;
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn() }, configurable: true });
    expect(isClipboardExportSupported()).toBe(false);
  });

  it('is false when navigator.clipboard.write is missing', () => {
    (globalThis as any).ClipboardItem = class {};
    Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
    expect(isClipboardExportSupported()).toBe(false);
  });
});

describe('buildOverlaySvg', () => {
  const W = 600; // === VIEWBOX_REF_W, so scale === 1
  const H = 400;

  function annotation(overrides: Partial<Annotation> = {}): Annotation {
    return {
      id: 'annotation-1',
      type: 'note',
      position: { x: 0.25, y: 0.25 },
      end: { x: 0.25, y: 0.25 },
      text: '',
      color: '#374151',
      bgColor: 'none',
      fontSize: 14,
      thickness: 2,
      arrowType: '→',
      ...overrides,
    };
  }

  it('emits no note/arrow/callout/watermark elements when nothing is configured', () => {
    const svg = buildOverlaySvg(W, H, baseOptions());
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('<line');
    expect(svg).not.toContain('<path');
  });

  it('renders multiple same-type text annotations in insertion order and ignores legacy singleton values', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        note: { text: 'legacy note', position: 'bottom-center', fontSize: 14, color: '#374151' },
        annotations: [
          annotation({ id: 'first', text: 'first note', position: { x: 0.2, y: 0.3 }, end: { x: 0.2, y: 0.3 } }),
          annotation({ id: 'second', text: 'second note', position: { x: 0.7, y: 0.4 }, end: { x: 0.7, y: 0.4 } }),
        ],
      }),
    );

    expect(svg.indexOf('>first note<')).toBeGreaterThan(-1);
    expect(svg.indexOf('>second note<')).toBeGreaterThan(svg.indexOf('>first note<'));
    expect(svg).not.toContain('legacy note');
    expect(svg.match(/<text/g)).toHaveLength(2);
  });

  it('renders multiple arrow annotations in insertion order and ignores the legacy arrow', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        arrow: { type: '→', label: 'legacy arrow', color: '#ef4444', thickness: 2 },
        arrowPoints: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
        annotations: [
          annotation({
            id: 'first-arrow',
            type: 'arrow',
            position: { x: 0.1, y: 0.2 },
            end: { x: 0.4, y: 0.2 },
            text: 'first arrow',
            color: '#2563eb',
            thickness: 3,
          }),
          annotation({
            id: 'second-arrow',
            type: 'arrow',
            position: { x: 0.6, y: 0.7 },
            end: { x: 0.9, y: 0.7 },
            text: 'second arrow',
            color: '#16a34a',
            thickness: 4,
          }),
        ],
      }),
    );

    expect(svg).not.toContain('legacy arrow');
    expect(svg.match(/<line/g)).toHaveLength(2);
    expect(svg.indexOf('>first arrow<')).toBeGreaterThan(-1);
    expect(svg.indexOf('>second arrow<')).toBeGreaterThan(svg.indexOf('>first arrow<'));
    expect(svg).toContain('x1="60" y1="80" x2="240" y2="80" stroke="#2563eb" stroke-width="3"');
    expect(svg).toContain('x1="360" y1="280" x2="540" y2="280" stroke="#16a34a" stroke-width="4"');
  });

  it('renders a rectangle from normalized corners using the minimum position and a none fill by default', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        annotations: [annotation({
          id: 'rectangle',
          type: 'rectangle',
          position: { x: 0.8, y: 0.7 },
          end: { x: 0.2, y: 0.3 },
          color: '#f97316',
          bgColor: 'none',
          thickness: 5,
        })],
      }),
    );

    expect(svg).toContain('<rect x="120" y="120" width="360" height="160" fill="none" stroke="#f97316" stroke-width="5"');
  });

  it('renders an annotation callout using end as its normalized tip and escapes its text', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        annotations: [annotation({
          id: 'callout',
          type: 'callout',
          position: { x: 0.5, y: 0.5 },
          end: { x: 0.5, y: 0.75 },
          text: 'A & <B> "quoted"',
          color: '#1e293b',
          bgColor: '#fffde7',
          fontSize: 14,
        })],
      }),
    );

    expect(svg).toContain('L 300 300 L');
    expect(svg).toContain('A &amp; &lt;B&gt; &quot;quoted&quot;');
    expect(svg).not.toContain('A & <B> "quoted"');
    expect(svg).not.toContain('textLength=');
  });

  it('fits an overlong callout label to the capped box only when its measured width exceeds the available width', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        annotations: [annotation({
          id: 'long-callout',
          type: 'callout',
          position: { x: 0.5, y: 0.5 },
          end: { x: 0.5, y: 0.5 },
          text: 'x'.repeat(200),
          bgColor: '#fffde7',
        })],
      }),
    );

    expect(svg).toContain('textLength="512" lengthAdjust="spacingAndGlyphs"');
  });

  it('renders the watermark exactly once after all annotations', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        watermark: { text: 'Watermark', opacity: 20, fontSize: 24, color: '#9ca3af', position: 'diagonal' },
        annotations: [
          annotation({ id: 'first', text: 'first note' }),
          annotation({ id: 'second', type: 'rectangle', end: { x: 0.5, y: 0.5 } }),
        ],
      }),
    );

    expect(svg.match(/>Watermark</g)).toHaveLength(1);
    expect(svg.lastIndexOf('>Watermark<')).toBeGreaterThan(svg.lastIndexOf('<rect'));
  });

  it('scales normalized annotation coordinates, font sizes, and thickness from the capture width', () => {
    const svg = buildOverlaySvg(
      1200,
      800,
      baseOptions({
        annotations: [
          annotation({ id: 'note', text: 'scaled note', position: { x: 0.25, y: 0.5 }, end: { x: 0.25, y: 0.5 }, fontSize: 14 }),
          annotation({ id: 'arrow', type: 'arrow', position: { x: 0.1, y: 0.25 }, end: { x: 0.4, y: 0.25 }, thickness: 3 }),
          annotation({ id: 'rectangle', type: 'rectangle', position: { x: 0.2, y: 0.3 }, end: { x: 0.5, y: 0.6 }, thickness: 4 }),
        ],
      }),
    );

    expect(svg).toContain('<text x="300" y="400" font-size="28"');
    expect(svg).toContain('x1="120" y1="200" x2="480" y2="200" stroke="#374151" stroke-width="6"');
    expect(svg).toContain('<rect x="240" y="240" width="360" height="240" fill="none" stroke="#374151" stroke-width="8"');
  });

  it('escapes &, <, >, and " in note text', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        note: { text: 'Tom & Jerry <b>"quoted"</b>', position: 'bottom-center', fontSize: 14, color: '#374151' },
        notePoint: { x: 0.25, y: 0.75 },
      }),
    );
    expect(svg).toContain('Tom &amp; Jerry &lt;b&gt;&quot;quoted&quot;&lt;/b&gt;');
    expect(svg).not.toContain('Tom & Jerry');
    expect(svg).not.toContain('<b>');
  });

  it('positions a dragged note by its fractional point, always centered', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        note: { text: 'hi', position: 'bottom-center', fontSize: 14, color: '#374151' },
        notePoint: { x: 0.25, y: 0.75 },
      }),
    );
    expect(svg).toContain('<text x="150" y="300" font-size="14" fill="#374151"');
    expect(svg).toContain('text-anchor="middle"');
  });

  it('falls back to the preset position (unified EDGE_PADDING) when no drag point is set', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        note: { text: 'hi', position: 'bottom-center', fontSize: 14, color: '#374151' },
        notePoint: null,
      }),
    );
    expect(svg).toContain('<text x="300" y="388" font-size="14" fill="#374151"');
  });

  it('draws a line, one forward arrowhead, and a midpoint label for a single "→" arrow', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        arrow: { type: '→', label: 'go', color: '#ef4444', thickness: 2 },
        arrowPoints: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
      }),
    );
    expect(svg).toContain('<line x1="0" y1="200" x2="600" y2="200" stroke="#ef4444" stroke-width="2" stroke-linejoin="round"/>');
    expect(svg).toContain('L 600 200 L'); // arrowhead tip at the end point
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
    expect(svg).toContain('<text x="300" y="214" font-size="14" fill="#ef4444"');
    expect(svg).toContain('>go<');
  });

  it('draws only a tail arrowhead (at the start point) for a "←" arrow', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        arrow: { type: '←', label: '', color: '#ef4444', thickness: 2 },
        arrowPoints: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
      }),
    );
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
    expect(svg).toContain('L 0 200 L'); // arrowhead tip at the start point
    expect(svg).not.toContain('L 600 200 L');
  });

  it('draws arrowheads at both ends for a "←→" arrow', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        arrow: { type: '←→', label: '', color: '#ef4444', thickness: 2 },
        arrowPoints: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
      }),
    );
    expect((svg.match(/<path/g) ?? []).length).toBe(2);
    expect(svg).toContain('L 0 200 L');
    expect(svg).toContain('L 600 200 L');
  });

  it('draws a callout box with a tail toward tipPosition when both are set', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        callout: {
          text: 'note',
          fontSize: 14,
          color: '#1e293b',
          bgColor: '#fffde7',
          position: { x: 0.5, y: 0.5 },
          tipPosition: { x: 0.5, y: 0.65 },
        },
      }),
    );
    // The tail leaves the box's own bottom edge — which now follows the label
    // and the font size rather than a fixed 40px box — and meets the tip.
    expect(svg).toMatch(/L 308 [\d.]+ L 300 260 L 292 [\d.]+ L/); // tail toward the tip
    expect(svg).toContain('fill="#fffde7" stroke="#94a3b8" stroke-width="1"');
    expect(svg).toContain('<text x="300" y="200" font-size="14" fill="#1e293b"');
    expect(svg).toContain('>note<');
  });

  it('draws a plain callout box (no tail) when tipPosition is absent', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        callout: {
          text: 'note',
          fontSize: 14,
          color: '#1e293b',
          bgColor: '#fffde7',
          position: { x: 0.5, y: 0.5 },
          tipPosition: null,
        },
      }),
    );
    expect(svg).not.toContain(' L 300 260 ');
  });

  it('renders the watermark diagonally through center with a rotate transform, honoring opacity', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        watermark: { text: 'Confidential', opacity: 20, fontSize: 24, color: '#9ca3af', position: 'diagonal' },
      }),
    );
    expect(svg).toContain('<text x="300" y="200" font-size="24" fill="#9ca3af" opacity="0.2"');
    expect(svg).toContain('transform="rotate(-45, 300, 200)"');
    expect(svg).toContain('>Confidential<');
  });

  it('pins the watermark bottom-right with no rotation when position is bottom-right', () => {
    const svg = buildOverlaySvg(
      W,
      H,
      baseOptions({
        watermark: { text: 'Confidential', opacity: 20, fontSize: 24, color: '#9ca3af', position: 'bottom-right' },
      }),
    );
    expect(svg).toContain('<text x="584" y="384" font-size="24" fill="#9ca3af" opacity="0.2"');
    expect(svg).not.toContain('rotate(');
    expect(svg).toContain('text-anchor="end"');
  });
});

describe('useExportEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('exportDiagram', () => {
    it('returns no_capture_node when neither an explicit node nor a global .screen-capture-content exists', async () => {
      const { exportDiagram } = useExportEngine();
      const result = await exportDiagram(baseOptions(), 'Login flow', null);
      expect(result).toEqual({ ok: false, reason: 'no_capture_node' });
      expect(captureBlob).not.toHaveBeenCalled();
    });

    it('falls back to the global .screen-capture-content when no node is passed', async () => {
      const el = document.createElement('div');
      el.className = 'screen-capture-content';
      document.body.appendChild(el);
      vi.mocked(captureBlob).mockResolvedValue(null);

      const { exportDiagram } = useExportEngine();
      await exportDiagram(baseOptions(), 'Login flow');
      expect(captureBlob).toHaveBeenCalledWith(el, expect.any(Object));
    });

    it('prefers the explicit node over any global .screen-capture-content match', async () => {
      const globalEl = document.createElement('div');
      globalEl.className = 'screen-capture-content';
      document.body.appendChild(globalEl);
      const explicitEl = document.createElement('div');
      vi.mocked(captureBlob).mockResolvedValue(null);

      const { exportDiagram } = useExportEngine();
      await exportDiagram(baseOptions(), 'Login flow', explicitEl);
      expect(captureBlob).toHaveBeenCalledWith(explicitEl, expect.any(Object));
    });

    it('returns blob_null when the capture yields no blob, without saving', async () => {
      const node = document.createElement('div');
      vi.mocked(captureBlob).mockResolvedValue(null);

      const { exportDiagram } = useExportEngine();
      const result = await exportDiagram(baseOptions(), 'Login flow', node);
      expect(result).toEqual({ ok: false, reason: 'blob_null' });
      expect(saveAs).not.toHaveBeenCalled();
    });
  });

  describe('exportDiagramToClipboard', () => {
    it('returns no_capture_node when neither an explicit node nor a global .screen-capture-content exists', async () => {
      const { exportDiagramToClipboard } = useExportEngine();
      const result = await exportDiagramToClipboard(baseOptions(), null);
      expect(result).toEqual({ ok: false, reason: 'no_capture_node' });
      expect(captureBlob).not.toHaveBeenCalled();
    });

    it('returns blob_null when the capture yields no blob, without touching the clipboard', async () => {
      const node = document.createElement('div');
      vi.mocked(captureBlob).mockResolvedValue(null);
      const clipboardWrite = vi.fn();
      Object.defineProperty(navigator, 'clipboard', { value: { write: clipboardWrite }, configurable: true });

      const { exportDiagramToClipboard } = useExportEngine();
      const result = await exportDiagramToClipboard(baseOptions(), node);
      expect(result).toEqual({ ok: false, reason: 'blob_null' });
      expect(clipboardWrite).not.toHaveBeenCalled();
    });
  });
});
