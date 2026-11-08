import { describe, expect, it } from 'vitest';
import { withMermaidTheme } from './renderMermaid';

const DIRECTIVE = '%%{init: {"theme": "dark"}}%%\n';

describe('withMermaidTheme', () => {
  it('prepends an init directive', () => {
    expect(withMermaidTheme('flowchart LR\n  A --> B', 'dark')).toBe(`${DIRECTIVE}flowchart LR\n  A --> B`);
  });

  it('places the directive after front matter, which must stay first', () => {
    const source = '---\ntitle: Orders\n---\nflowchart LR\n  A --> B';
    expect(withMermaidTheme(source, 'dark')).toBe(`---\ntitle: Orders\n---\n${DIRECTIVE}flowchart LR\n  A --> B`);
  });

  it('keeps a theme the author chose in front matter', () => {
    const source = '---\nconfig:\n  theme: forest\n---\nflowchart LR\n  A --> B';
    expect(withMermaidTheme(source, 'dark')).toBe(source);
  });

  it('keeps a theme the author chose in an init directive', () => {
    const source = "%%{init: {'theme':'base'}}%%\nflowchart LR\n  A --> B";
    expect(withMermaidTheme(source, 'dark')).toBe(source);
  });

  it('still themes a source whose init directive sets something else', () => {
    const source = '%%{init: {"flowchart": {"curve": "linear"}}}%%\nflowchart LR\n  A --> B';
    expect(withMermaidTheme(source, 'dark')).toBe(DIRECTIVE + source);
  });
});
