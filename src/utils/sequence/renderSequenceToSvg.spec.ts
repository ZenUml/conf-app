import { describe, it, expect, vi, beforeEach } from 'vitest';

const renderToSvg = vi.fn();
vi.mock('@zenuml/core', () => ({ default: vi.fn(), renderToSvg }));

import { renderSequenceToSvg } from './renderSequenceToSvg';

describe('renderSequenceToSvg', () => {
  beforeEach(() => renderToSvg.mockReset());

  it('returns the rendered svg string', async () => {
    renderToSvg.mockReturnValue({ svg: '<svg id="x">ok</svg>' });
    await expect(renderSequenceToSvg('A.b()')).resolves.toBe('<svg id="x">ok</svg>');
    expect(renderToSvg).toHaveBeenCalledWith('A.b()');
  });

  it('returns undefined for empty code without invoking the renderer', async () => {
    await expect(renderSequenceToSvg('')).resolves.toBeUndefined();
    expect(renderToSvg).not.toHaveBeenCalled();
  });

  it('returns undefined when renderToSvg yields no svg', async () => {
    renderToSvg.mockReturnValue({ svg: '' });
    await expect(renderSequenceToSvg('A.b()')).resolves.toBeUndefined();
  });

  it('never throws — returns undefined when reading the result throws', async () => {
    // A throwing `.svg` getter exercises the catch from inside the try without a
    // rejected promise leaking past vitest's matcher (mirrors renderMermaidToSvg.spec).
    renderToSvg.mockReturnValue({
      get svg(): string {
        throw new Error('parse error');
      },
    });
    await expect(renderSequenceToSvg('garbage')).resolves.toBeUndefined();
  });
});
