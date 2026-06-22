import { describe, it, expect, vi, beforeEach } from 'vitest';

const renderMock = vi.fn();
vi.mock('./loadMermaid', () => ({
  loadMermaid: () => Promise.resolve({ render: renderMock }),
}));

import { renderMermaidToSvg } from './renderMermaidToSvg';

describe('renderMermaidToSvg', () => {
  beforeEach(() => renderMock.mockReset());

  it('returns the rendered svg string', async () => {
    renderMock.mockResolvedValue({ svg: '<svg id="x">ok</svg>' });
    await expect(renderMermaidToSvg('sequenceDiagram\n A->>B: hi')).resolves.toBe('<svg id="x">ok</svg>');
    expect(renderMock).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for empty code without invoking mermaid', async () => {
    await expect(renderMermaidToSvg('')).resolves.toBeUndefined();
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('never throws — returns undefined when mermaid.render misbehaves', async () => {
    // render resolves to a malformed value, so destructuring `{ svg }` throws
    // INSIDE our try → exercises the catch path without a rejected promise
    // (which would trip vitest's unhandled-rejection guard, not our code).
    renderMock.mockResolvedValue(undefined);
    const result = await renderMermaidToSvg('not valid mermaid');
    expect(result).toBeUndefined();
  });
});
