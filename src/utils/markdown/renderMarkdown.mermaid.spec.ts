import { describe, expect, it, vi } from 'vitest';

// Real mermaid, not the fake in renderMarkdown.spec.ts: the point is the exact
// rejection mermaid produces, which a hand-written fake can drift from.
vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const mermaid = (await import('mermaid')).default;
  return { loadMermaid: async () => mermaid };
});

import { renderMarkdown } from './renderMarkdown';

describe('Markdown documents with the real Mermaid parser', () => {
  it('points at the semicolon that splits a sequence diagram note', async () => {
    const diagram = [
      'sequenceDiagram',
      '    participant Script as routerconsolidate.py',
      '    participant Integ as Integrate Job',
      '    Note over Script,Integ: Files left untouched;<br/>next cap_end retries',
    ].join('\n');
    const result = await renderMarkdown(`\`\`\`mermaid\n${diagram}\n\`\`\``);
    expect(result.failedBlocks).toBe(1);
    expect(result.html).toContain('Parse error on line 4:');
    expect(result.html).toContain('Write #59; for a literal semicolon.');
    expect(result.html).not.toContain('Expecting ');
  });
});
