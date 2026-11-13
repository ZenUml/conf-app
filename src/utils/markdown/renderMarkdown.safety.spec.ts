import { describe, expect, it } from 'vitest';
import { renderMarkdownDocument } from './renderMarkdownDocument';

const draw = async (id: string) => ({ svg: `<svg id="${id}"></svg>` });

describe('Markdown safety and GFM output', () => {
  it('opens every link in a new tab without opener access', async () => {
    const { html } = await renderMarkdownDocument('[a](https://example.com "t") and <https://auto.example.com>', draw);
    expect(html.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(2);
  });
  it('empties unsafe URL schemes but keeps relative and mailto links', async () => {
    const { html } = await renderMarkdownDocument('[a](javascript:alert(1)) [b](JavaScript:alert(1)) ![c](data:text/html;base64,AAAA) [d](mailto:a@example.com) [e](/rel?x=a:b)', draw);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toContain('data:');
    expect(html).toContain('href="mailto:a@example.com"');
    expect(html).toContain('href="/rel?x=a:b"');
  });
  it('shows raw HTML as text, inline and as a block', async () => {
    const { html } = await renderMarkdownDocument('<img src=x onerror=alert(1)>\n\ntext <b>raw</b>', draw);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;raw&lt;/b&gt;');
  });
  it('renders strikethrough, task lists and aligned table columns', async () => {
    const { html } = await renderMarkdownDocument('~~gone~~\n\n- [x] done\n\n| A |\n|--:|\n| 1 |', draw);
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('style="text-align:right"');
  });
  it('replaces a mermaid fence with a placeholder that receives the SVG', async () => {
    const result = await renderMarkdownDocument('```mermaid\nflowchart TD\nA-->B\n```', draw);
    expect(result.html).toMatch(/<div data-markdown-diagram="markdown-\d+-0" class="markdown-diagram"><svg id="markdown-\d+-0"><\/svg><\/div>/);
    expect(result.html).not.toContain('<pre>');
  });
});
