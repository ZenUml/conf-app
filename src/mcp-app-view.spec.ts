import { describe, it, expect } from 'vitest';
import { extractDiagram } from './mcp-app-view';

describe('extractDiagram', () => {
  // The host decides which of these shapes it hands us, and the answer has
  // differed per host in practice, so all three are supported deliberately
  // rather than by accident.
  it('reads structuredContent when the host provides it', () => {
    expect(extractDiagram({ structuredContent: { diagramType: 'mermaid', dsl: 'graph TD;A-->B;' } }))
      .toEqual({ diagramType: 'mermaid', dsl: 'graph TD;A-->B;', title: undefined });
  });

  it('reads a JSON text block when structuredContent is absent', () => {
    const payload = { diagramType: 'sequence', dsl: 'A->B: hi', title: 'Login' };
    expect(extractDiagram({ content: [{ type: 'text', text: JSON.stringify(payload) }] }))
      .toEqual(payload);
  });

  it('reads a bare payload passed straight through', () => {
    expect(extractDiagram({ diagramType: 'sequence', dsl: 'A->B: hi' }))
      .toEqual({ diagramType: 'sequence', dsl: 'A->B: hi', title: undefined });
  });

  it('accepts `code` as well as `dsl`, so stored custom content renders', () => {
    // `dsl` is what the tools return; `code` is the field Confluence stores.
    expect(extractDiagram({ structuredContent: { diagramType: 'sequence', code: 'A->B: hi' } }))
      .toEqual({ diagramType: 'sequence', dsl: 'A->B: hi', title: undefined });
  });

  it('prefers structuredContent over a text block that disagrees', () => {
    const result = {
      structuredContent: { diagramType: 'mermaid', dsl: 'from-structured' },
      content: [{ type: 'text', text: JSON.stringify({ diagramType: 'sequence', dsl: 'from-text' }) }],
    };
    expect(extractDiagram(result)?.dsl).toBe('from-structured');
  });

  it('skips a text block that is not JSON rather than giving up', () => {
    const result = {
      content: [
        { type: 'text', text: 'Updated the diagram.' },
        { type: 'text', text: JSON.stringify({ diagramType: 'mermaid', dsl: 'graph TD;A-->B;' }) },
      ],
    };
    expect(extractDiagram(result)?.dsl).toBe('graph TD;A-->B;');
  });

  it('returns null when there is no diagram, so the view can say so', () => {
    // A blank iframe is the worst outcome; null is what drives the message.
    for (const empty of [
      undefined,
      null,
      {},
      { content: [] },
      { content: [{ type: 'text', text: 'not json' }] },
      { structuredContent: { diagramType: 'mermaid' } },       // no dsl
      { structuredContent: { dsl: 'graph TD;A-->B;' } },        // no type
      { structuredContent: { diagramType: 42, dsl: 'x' } },
    ]) {
      expect(extractDiagram(empty)).toBeNull();
    }
  });

  it('ignores non-text content blocks', () => {
    expect(extractDiagram({ content: [{ type: 'image', data: 'base64' }] })).toBeNull();
  });
});
