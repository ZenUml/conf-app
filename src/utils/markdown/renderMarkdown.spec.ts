import { describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from './renderMarkdown';

const render = vi.hoisted(() => vi.fn(async (id: string, source: string) => {
  if (source.includes('broken')) throw new Error('invalid diagram');
  if (source.includes('untouched;')) {
    // Shape of mermaid 11's real rejection for this customer's diagram: the
    // message echoes the offending source line verbatim, markup included.
    throw new Error("Parse error on line 2:\n... left untouched;<br/>next cap_end retrie\n-----------------------^\nExpecting 'NEWLINE', ',', 'TXT', got 'INVALID'");
  }
  return { svg: `<svg id="${id}"><text>${source.trim()}</text></svg>` };
}));
vi.mock('@/utils/mermaid/loadMermaid', () => ({ loadMermaid: async () => ({ render }) }));

describe('Markdown documents', () => {
  it('renders prose, GFM tables and multiple diagrams in document order', async () => {
    const result = await renderMarkdown('# Title\n\nBefore\n\n```mermaid\nflowchart TD\nA-->B\n```\n\n| Name | Value |\n| --- | --- |\n| X | 1 |\n\n```mermaid\nsequenceDiagram\nA->>B: Hi\n```\n\nAfter');
    expect(result.html).toContain('<h1>Title</h1>');
    expect(result.html).toContain('<table>');
    expect(result.html.match(/<svg /g)).toHaveLength(2);
    expect(result.html.indexOf('Before')).toBeLessThan(result.html.indexOf('<svg'));
    expect(result.html.lastIndexOf('</svg>')).toBeLessThan(result.html.indexOf('After'));
    expect(result).toMatchObject({ mermaidBlocks: 2, failedBlocks: 0 });
  });
  it('isolates a malformed diagram and keeps the document and other diagrams', async () => {
    const result = await renderMarkdown('Hello\n\n```mermaid\nbroken\n```\n\n```mermaid\nflowchart TD\nA-->B\n```\n\nGoodbye');
    expect(result.html).toContain('Hello');
    expect(result.html).toContain('Could not render Mermaid diagram');
    expect(result.html).toContain('<svg');
    expect(result.html).toContain('Goodbye');
    expect(result.failedBlocks).toBe(1);
  });
  it('tells the author where a diagram failed to parse, without rendering the echoed source as HTML', async () => {
    const diagram = 'sequenceDiagram\nNote over A,B: Files left untouched;<br/>next cap_end retries';
    const result = await renderMarkdown(`\`\`\`mermaid\n${diagram}\n\`\`\``);
    expect(result.html).toContain('Parse error on line 2:');
    expect(result.html).toContain('left untouched;&lt;br/&gt;next cap_end retrie');
    expect(result.html).not.toContain('untouched;<br/>');
    expect(result.failedBlocks).toBe(1);
  });
  it('explains that a semicolon ends a sequence diagram statement when one caused the failure', async () => {
    const sequence = await renderMarkdown('```mermaid\nsequenceDiagram\nNote over A,B: Files left untouched;<br/>next\n```');
    expect(sequence.html).toContain('#59;');
    const other = await renderMarkdown('```mermaid\nbroken\n```');
    expect(other.html).not.toContain('#59;');
  });
  it('does not execute raw HTML or unsafe links, and preserves ordinary code fences', async () => {
    const result = await renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n```js\nconst x = 1;\n```');
    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain('href="javascript:');
    expect(result.html).toContain('language-js');
    expect(result.mermaidBlocks).toBe(0);
  });
});
