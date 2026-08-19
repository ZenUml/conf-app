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
  type ExportOptions,
} from './useExportEngine';

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

  it('emits no note/arrow/callout/watermark elements when nothing is configured', () => {
    const svg = buildOverlaySvg(W, H, baseOptions());
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('<line');
    expect(svg).not.toContain('<path');
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
    expect(svg).toContain('L 308 220 L 300 260 L 292 220 L'); // tail toward the tip
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
